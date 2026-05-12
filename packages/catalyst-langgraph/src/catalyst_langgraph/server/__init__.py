"""FastAPI entrypoint for catalyst-langgraph.

Endpoints:
  GET  /healthz                Liveness probe.
  POST /api/chat/stream        SSE — typed agent events (see events.py).
  GET  /api/models             LiteLLM model catalogue.
  GET  /api/tools              Dispatchable tools registry.
  GET  /api/agents             Registered Agents + schemas.
  GET  /api/runs               DuckDB event trace (observability).

Run locally:
    python -m catalyst_langgraph.server
or:
    uvicorn catalyst_langgraph.server:app --reload --port 7078

Module structure (split out during the llm-doh refactor — boilerplate
lives in sibling modules, this file owns the agent-loop + API surface):
  server/app.py        — make_app() factory + OPENAPI tag schema
  server/lifespan.py   — EventStore lifecycle (FastAPI lifespan)
  server/log_setup.py  — setup_logging() entrypoint (named log_setup
                          to avoid shadowing stdlib `logging`)
  server/health.py     — /healthz APIRouter
  server/__main__.py   — `python -m catalyst_langgraph.server` shim
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, AsyncIterator, Literal, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

import httpx

from ..client import CatalystLiteLLMClient
from ..events import (
    AgentEvent,
    Cancelled,
    ChatStreamRequest,
    ErrorEvent,
    Iteration,
    MessageDone,
    RunStarted,
    Token,
    ToolCallEnd,
    ToolCallStart,
)
from ..agents import AGENTS, validate_overrides
from ..graph import build_graph
from ..persistence import get_event_store
from ..tools import ALL_TOOLS
from ..tools.cancel import cancel_event, install_cancel_event
from ..tools.host import TOOL_HOST_API_KEY, TOOL_HOST_URL
from ..tools.research import caller_context, research_overrides

from .app import make_app
from .health import health_router
from .lifespan import app_lifespan
from .log_setup import setup_logging

setup_logging()
log = logging.getLogger("catalyst-langgraph")

app = make_app(lifespan=app_lifespan)
app.include_router(health_router)


# ───────────────────────────────────────────────────────────────────────
# Message coercion — accept OpenAI-style dicts, return LangChain messages
# ───────────────────────────────────────────────────────────────────────


def _coerce_messages(raw: list[dict[str, Any]]) -> list[BaseMessage]:
    """Convert {role, content, …} dicts into LangChain messages.

    Tool-result messages from the UI come back as
    {role: "tool", tool_call_id, content}; we forward them so the model
    keeps its threading. Anything unrecognised becomes a Human (best
    effort — chat history coming from a UI is usually well-formed)."""
    out: list[BaseMessage] = []
    for m in raw:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            out.append(SystemMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        elif role == "tool":
            out.append(
                ToolMessage(
                    content=content,
                    tool_call_id=m.get("tool_call_id", ""),
                )
            )
        else:
            out.append(HumanMessage(content=content))
    return out


def _summarise_caller_context(
    raw_messages: list[dict[str, Any]],
    system_prompt: Optional[str],
) -> str:
    """Compress the parent chat's recent history into a short brief.

    The research sub-agent receives this via the `caller_context`
    ContextVar so each council member knows what the chat is *about*,
    not just the immediate `query` arg. We keep it short and only
    include the last few user turns + the parent's system prompt —
    members don't need every token of history, just enough trajectory
    to avoid generic searches.

    Returns "" when there's nothing useful to share (chat just
    started, no system prompt) so the tool can detect "no context".
    """
    PER_MSG_CAP = 400      # chars; trims monster pastes
    MAX_USER_MSGS = 3
    parts: list[str] = []

    if system_prompt and system_prompt.strip():
        sp = system_prompt.strip()
        if len(sp) > PER_MSG_CAP:
            sp = sp[: PER_MSG_CAP - 1].rstrip() + "…"
        parts.append(f"Parent assistant's system prompt:\n{sp}")

    user_turns: list[str] = []
    for m in raw_messages:
        if (m.get("role") or "") != "user":
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if len(content) > PER_MSG_CAP:
            content = content[: PER_MSG_CAP - 1].rstrip() + "…"
        user_turns.append(content)

    recent_user = user_turns[-MAX_USER_MSGS:]
    if recent_user:
        formatted = "\n".join(f"- {u}" for u in recent_user)
        parts.append(f"Recent user messages in the parent chat:\n{formatted}")

    return "\n\n".join(parts).strip()


# ───────────────────────────────────────────────────────────────────────
# Event translation — LangGraph astream_events(v2) → typed AgentEvents
# ───────────────────────────────────────────────────────────────────────


async def _stream_agent_events(
    *, request: ChatStreamRequest
) -> AsyncIterator[AgentEvent]:
    """Run the graph and yield our typed events to the SSE consumer.

    This is the public entry point — it wraps `_produce_agent_events`
    (the actual graph-driving generator) with a side-effect: every
    yielded event is also inserted into the EventStore (DuckDB) so
    runs become queryable / replayable. Wrapping at this layer keeps
    the producer purely declarative — adding a new event type means
    adding one yield in `_produce_agent_events`; tracing is automatic.

    Cancellation: when the SSE consumer disconnects, uvicorn raises
    `CancelledError` at our next `yield` (or `GeneratorExit` if our
    `aclose()` is called). We translate that into a final `Cancelled`
    event INSIDE the inner producer so it lands in the trace; here we
    just have to make sure it gets flushed to the store before the
    fast-path teardown kills the queue.
    """
    store = get_event_store()
    run_id: Optional[str] = None
    seq = 0

    def _persist(ev: AgentEvent) -> None:
        """Mirror one event into the store. No-op when store disabled."""
        nonlocal run_id, seq
        if run_id is None and ev.type == "run_started":
            run_id = getattr(ev, "run_id", None)
            if store is not None and run_id is not None:
                # Snapshot the run's config alongside the event trace
                # so later queries can correlate cost / behaviour back
                # to what the parent was configured with.
                try:
                    store.insert_run_config(
                        run_id=run_id,
                        model=request.model,
                        tools=request.tools,
                        agent_config=request.agent_config,
                        system_prompt=request.system_prompt,
                    )
                except Exception as exc:
                    log.warning("event_store run_config insert failed: %s", exc)
        if store is not None and run_id is not None:
            try:
                store.insert(
                    run_id=run_id,
                    seq=seq,
                    kind=ev.type,
                    payload=ev.model_dump(),
                )
            except Exception as exc:
                log.warning("event_store insert failed (%s): %s", ev.type, exc)
        seq += 1

    async for ev in _produce_agent_events(request=request):
        _persist(ev)
        yield ev


async def _produce_agent_events(
    *, request: ChatStreamRequest
) -> AsyncIterator[AgentEvent]:
    """Run the graph and yield our typed events.

    Translates LangGraph's astream_events(version="v2") firehose:
      on_chat_model_stream → Token (per content chunk)
      on_tool_start        → ToolCallStart (carries args, tool name)
      on_tool_end          → ToolCallEnd (carries result, duration)
      on_chain_start "tools" → Iteration (one per tool-loop entry)
      on_chat_model_end    → MessageDone (carries usage / finish_reason)

    We pair start/end via LangGraph's `run_id` (stable per tool call).
    Anything unexpected becomes a logged warning, not an event — the UI
    contract stays small and predictable.
    """
    run_id = uuid.uuid4().hex[:12]
    yield RunStarted(run_id=run_id, model=request.model)

    # agent_config carries per-node overrides:
    #   { "<agent_id>": { "<node_id>": {field: value, ...}, ... }, ... }
    # Each inner-most dict is validated through the matching node's
    # Pydantic config_model so bogus fields and wrong types are
    # rejected here instead of bubbling into LangGraph as silent type
    # errors. validate_overrides returns only the keys the operator
    # explicitly set (model_dump(exclude_unset=True)) — we never pin
    # defaults into the override dict.
    #
    # The `agent` node of the main loop owns every LLM-call tunable
    # (model, temperature, max_tokens, top_p, recursion_limit,
    # system_prompt) — those merge over the legacy `params` channel
    # below.
    agent_config_raw = request.agent_config or {}
    main_raw = agent_config_raw.get("main") or {}
    research_raw = agent_config_raw.get("research") or {}
    prompt_overrides = request.prompt_overrides or {}

    def _resolve_prompt_ref(node_raw: dict[str, Any]) -> dict[str, Any]:
        """If the operator bound this node to a saved prompt
        (`system_prompt_ref`), look it up in the request's prompt
        overrides map and write the resolved content into
        `system_prompt` before validation. Strip the ref afterwards
        so the validated dict matches the runtime contract (ref is a
        UI-side concept; the agent code only reads `system_prompt`)."""
        if not node_raw or "system_prompt_ref" not in node_raw:
            return node_raw
        out = dict(node_raw)
        ref = out.pop("system_prompt_ref")
        if ref and ref in prompt_overrides:
            out["system_prompt"] = prompt_overrides[ref]
        # else: ref was set but the map didn't carry the content
        # (operator dispatched without exposing the prompt). Fall
        # through to whatever inline `system_prompt` is present, or
        # the node's default.
        return out

    try:
        main_overrides = validate_overrides(
            "main", "agent", _resolve_prompt_ref(main_raw.get("agent") or {})
        )
        validated_research = {
            "members": validate_overrides(
                "research",
                "members",
                _resolve_prompt_ref(research_raw.get("members") or {}),
            ),
            "critic": validate_overrides(
                "research",
                "critic",
                _resolve_prompt_ref(research_raw.get("critic") or {}),
            ),
            "fusion": validate_overrides(
                "research",
                "fusion",
                _resolve_prompt_ref(research_raw.get("fusion") or {}),
            ),
        }
    except Exception as exc:
        log.warning("agent_config validation failed: %s", exc)
        yield ErrorEvent(message=f"agent_config validation failed: {exc}")
        return
    params = {**(request.params or {}), **main_overrides}

    # System prompt comes from main_overrides if the Engine tab set it,
    # else falls back to the per-chat field on the request.
    effective_system_prompt = main_overrides.get(
        "system_prompt", request.system_prompt
    )

    # Pull recursion_limit OUT of params before they get forwarded to
    # build_graph — LangGraph applies it via per-invocation config, not
    # as a graph-build kwarg. Default 25 matches LangGraph's own.
    recursion_limit = int(params.pop("recursion_limit", 25))

    extra_kwargs = {
        k: v
        for k, v in params.items()
        if k not in ("temperature", "max_tokens", "system_prompt")
    }
    # Anthropic rejects requests that set both `temperature` and `top_p`.
    # top_p=1.0 is a no-op (no nucleus sampling), so drop it before it
    # reaches the provider — the UI sends it unconditionally as a slider
    # default, but the user hasn't actually opted into it.
    if extra_kwargs.get("top_p") in (1, 1.0):
        extra_kwargs.pop("top_p", None)

    # Per-request research overrides flow through a ContextVar so the
    # @tool function picks them up without changing its signature
    # (which would break the parent's tool-calling contract). The
    # ContextVar is reset in the finally block below.
    research_overrides_token = research_overrides.set(validated_research)

    # Caller context: pass the parent chat's recent user-side
    # conversation into the research tool's ContextVar so each
    # council member sees the trajectory of the chat, not just the
    # `query` arg. The parent model can still override with an
    # explicit `context=...` tool arg if it wants to be deliberate.
    # Cap at the last 3 user turns + truncate each to ~400 chars —
    # enough to capture the topic, not enough to dominate the
    # research prompt.
    caller_context_token = caller_context.set(
        _summarise_caller_context(request.messages, request.system_prompt)
    )

    # Explicit cancellation channel: sub-agents (research council
    # members, critic, fusion) await / poll this Event to short-circuit
    # cleanly when the user presses STOP. The implicit cascade via
    # asyncio.CancelledError still works — this is BELT + suspenders.
    # The event is set in the finally block so any straggler races
    # resolve to their cancellation placeholder rather than blocking.
    cancel_ev, cancel_token = install_cancel_event()

    def _reset_request_contextvars() -> None:
        """Restore all per-request ContextVars to their pre-request state.

        Called from every exit path — normal completion, errors,
        cancellation, GeneratorExit. Keeping this in one place is the
        defence against ContextVar leakage between requests on the
        same uvicorn worker (which was issue (b) in the cancel-bus
        design doc).
        """
        try:
            research_overrides.reset(research_overrides_token)
        except (ValueError, LookupError):
            pass
        try:
            caller_context.reset(caller_context_token)
        except (ValueError, LookupError):
            pass
        try:
            cancel_event.reset(cancel_token)
        except (ValueError, LookupError):
            pass

    try:
        app_graph = build_graph(
            model=request.model,
            tool_names=request.tools or None,
            system_prompt=effective_system_prompt,
            temperature=params.get("temperature", 0.7),
            max_tokens=params.get("max_tokens"),
            extra_model_kwargs=extra_kwargs or None,
        )
    except Exception as exc:  # bad model / config / wiring
        log.exception("graph build failed")
        yield ErrorEvent(message=f"graph build failed: {exc}")
        _reset_request_contextvars()
        return

    state = {"messages": _coerce_messages(request.messages)}

    iteration = 0
    tool_starts: dict[str, tuple[str, float]] = {}  # run_id → (name, started_at)
    last_usage: Optional[dict[str, Any]] = None
    last_finish: Optional[str] = None

    # Stack of currently-in-flight parent-level tool calls. Used to
    # tag nested events (those produced INSIDE a tool execution, like
    # the research agent's council members + critic + fusion) with
    # the owning tool_call_id so the UI can route them into that
    # tool's expandable section instead of dumping into the parent
    # chat bubble. The most-recently-started outer tool is what we
    # attribute to — LangChain's astream_events fires on_tool_start /
    # on_tool_end at the PARENT level only (inner ToolNodes inside
    # sub-graphs don't bubble up as on_tool_start at the outer
    # stream), so depth >1 is rare in practice; LIFO is correct
    # either way.
    outer_tool_stack: list[str] = []

    def _current_owner_tool_id() -> Optional[str]:
        """The tool whose execution we're currently inside, or None."""
        return outer_tool_stack[-1] if outer_tool_stack else None

    try:
        async for ev in app_graph.astream_events(
            state,
            version="v2",
            config={"recursion_limit": recursion_limit},
        ):
            kind = ev.get("event")
            data = ev.get("data") or {}
            name = ev.get("name") or ""

            if kind == "on_chain_start" and name == "tools":
                # Only count parent-level tool-loop entries. The
                # council members' inner "tools" nodes also fire this
                # event via astream_events' deep tracing — without
                # this gate they'd inflate the parent's iteration
                # counter into nonsense (each member ticks +1 per
                # internal web_search round-trip).
                if not outer_tool_stack:
                    iteration += 1
                    yield Iteration(n=iteration)

            elif kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                content = getattr(chunk, "content", "") if chunk else ""
                if isinstance(content, list):
                    # Some providers stream content as a list of typed parts.
                    content = "".join(
                        p.get("text", "") if isinstance(p, dict) else str(p)
                        for p in content
                    )
                if content:
                    yield Token(
                        content=content,
                        owner_tool_id=_current_owner_tool_id(),
                    )

            elif kind == "on_chat_model_end":
                # LangChain stashes usage + finish in different places
                # depending on provider; pull the common shape and fall
                # back gracefully. Only adopt usage / finish_reason from
                # the OUTER LLM call (no in-flight tool) — sub-agent
                # LLM completions inside research would otherwise
                # overwrite the parent's stats.
                if not outer_tool_stack:
                    output = data.get("output")
                    meta = getattr(output, "response_metadata", None) or {}
                    usage = getattr(output, "usage_metadata", None)
                    if usage:
                        last_usage = (
                            dict(usage) if not isinstance(usage, dict) else usage
                        )
                    fr = meta.get("finish_reason") or meta.get("stop_reason")
                    if fr:
                        last_finish = fr

            elif kind == "on_tool_start":
                tcid = ev.get("run_id") or uuid.uuid4().hex
                tool_starts[tcid] = (name, time.monotonic())
                args = data.get("input") or {}
                # ToolNode passes the parsed arg dict directly; if the
                # tool only takes a single string, langchain wraps it.
                if not isinstance(args, dict):
                    args = {"input": args}
                # Attribute this tool call to its OWNER (if any) before
                # pushing it onto the stack — that way the outermost
                # tool isn't "owned by itself".
                yield ToolCallStart(
                    id=tcid,
                    name=name,
                    args=args,
                    owner_tool_id=_current_owner_tool_id(),
                )
                outer_tool_stack.append(tcid)

            elif kind == "on_tool_end":
                tcid = ev.get("run_id") or ""
                started = tool_starts.pop(tcid, (name, time.monotonic()))[1]
                duration_ms = int((time.monotonic() - started) * 1000)
                output = data.get("output")
                # ToolMessage stringifies cleanly; raw strings pass through.
                result = (
                    output.content
                    if isinstance(output, ToolMessage)
                    else output
                )
                # Pop the matching tool from the stack — be defensive
                # against out-of-order ends (shouldn't happen but
                # logging churn isn't worth a crash).
                if tcid in outer_tool_stack:
                    outer_tool_stack.remove(tcid)
                # The end-event itself is attributed to the tool's
                # OWNER (one level out from the tool that's ending),
                # which is None for top-level tools.
                yield ToolCallEnd(
                    id=tcid,
                    result=result,
                    duration_ms=duration_ms,
                    owner_tool_id=_current_owner_tool_id(),
                )
    except asyncio.CancelledError:
        # SSE consumer disconnected (UI pressed STOP / closed the tab).
        # 1) Set the cooperative cancel signal so any race_with_cancel()
        #    in flight inside sub-agents resolves to its placeholder
        #    instead of blocking.
        # 2) Synthesise tool_call_end events for anything currently
        #    in-flight so the trace has no orphan tool_call_start rows
        #    (gap (d) in the design doc).
        # 3) Yield a terminal `Cancelled` event so the UI knows the
        #    server cooperated rather than the connection just dying.
        # We DO NOT re-raise — re-raising would prevent the final yield
        # from flowing through `_stream_agent_events` into the event
        # store. Letting the generator return cleanly lets the wrapper
        # call `_persist(Cancelled)` before its own task is reaped.
        log.info("agent stream cancelled — propagating to sub-agents")
        cancel_ev.set()
        in_flight = list(outer_tool_stack)
        for tcid in in_flight:
            started = tool_starts.pop(tcid, ("", time.monotonic()))[1]
            duration_ms = int((time.monotonic() - started) * 1000)
            try:
                yield ToolCallEnd(
                    id=tcid,
                    error="cancelled",
                    duration_ms=duration_ms,
                    owner_tool_id=None,
                )
            except (asyncio.CancelledError, GeneratorExit):
                # Consumer is fully gone; the event still lands in the
                # store via _persist() above the yield in the wrapper.
                break
        try:
            yield Cancelled(
                reason="client_abort",
                propagated_to=in_flight or None,
            )
        except (asyncio.CancelledError, GeneratorExit):
            pass
        return
    except GeneratorExit:
        # The async generator was closed (aclose()) — e.g. the SSE
        # response wrapper unwound before we finished. Same logic as
        # CancelledError but we MUST NOT yield further (GeneratorExit
        # is the contract for "no more sends"). Just clean up and
        # re-raise per PEP 525.
        cancel_ev.set()
        _reset_request_contextvars()
        raise
    except Exception as exc:
        log.exception("agent stream errored")
        yield ErrorEvent(message=str(exc))
        return
    finally:
        # Always reset ContextVars (research_overrides, caller_context,
        # cancel_event) — leaving them set would leak the previous
        # request's state into the next one running on the same worker.
        # Also set cancel_ev defensively so any straggler awaits inside
        # cancelled sub-tasks resolve to their placeholder.
        cancel_ev.set()
        _reset_request_contextvars()

    yield MessageDone(finish_reason=last_finish, usage=last_usage)


def _to_sse(event: AgentEvent) -> dict[str, str]:
    """Encode a typed event as an SSE message dict for sse-starlette.

    We use named events (`event:` line) AND a JSON payload so consumers
    can route by name without parsing — the data field still carries
    the full typed body for parsers that prefer that shape."""
    return {
        "event": event.type,
        "data": json.dumps(event.model_dump(exclude_none=True)),
    }


# ───────────────────────────────────────────────────────────────────────
# Routes
# ───────────────────────────────────────────────────────────────────────


@app.post(
    "/api/chat/stream",
    tags=["chat"],
    summary="Stream a chat completion as typed Agent events",
    description=(
        "Server-Sent Events stream of typed `AgentEvent`s (run_started, "
        "token, reasoning, tool_call_start, tool_call_end, iteration, "
        "message_done, error). The wire format is `text/event-stream`; "
        "each `data:` line is one JSON-encoded event with a `type` "
        "discriminator. Use Agent-level overrides via `agent_config` "
        "to tune individual Agents in the graph (see GET /api/agents "
        "for the schemas)."
    ),
    response_class=EventSourceResponse,
)
async def chat_stream(req: ChatStreamRequest) -> EventSourceResponse:
    """Stream a chat completion as typed agent events.

    See events.py for the union of event types the UI can expect."""
    async def gen() -> AsyncIterator[dict[str, str]]:
        async for ev in _stream_agent_events(request=req):
            yield _to_sse(ev)

    return EventSourceResponse(gen())


# ───────────────────────────────────────────────────────────────────────
# Discovery — /api/models proxies LiteLLM, /api/tools mirrors what the
# agent can call. UIs use these to populate dropdowns / toggles.
# ───────────────────────────────────────────────────────────────────────


@app.get(
    "/api/models",
    tags=["discovery"],
    summary="List models known to the LiteLLM proxy",
    description=(
        "Returns the union of LiteLLM's `/v1/models` and `/model/info` "
        "endpoints, one entry per known model. UIs use this to populate "
        "the model dropdowns and the Engine tab's `widget=\"model\"` "
        "fields."
    ),
)
def list_models() -> dict[str, Any]:
    """Return the union of /v1/models + /model/info from LiteLLM.

    Same shape we used in the TS SDK (see CatalystLLMClient.getModelsWithRouting):
    each entry is {id, endpoint?, metadata?, underlyingModel?} so the UI can
    render the same chips/dropdowns it does today."""
    client = CatalystLiteLLMClient()
    models = client.get_models() or []
    info_list = client.get_model_info() or []
    info_by_name = {
        entry.get("model_name"): entry
        for entry in info_list
        if isinstance(entry, dict) and entry.get("model_name")
    }
    out = []
    for mid in models:
        entry = info_by_name.get(mid) or {}
        litellm_params = entry.get("litellm_params") or {}
        out.append(
            {
                "id": mid,
                "underlying_model": litellm_params.get("model"),
                "api_base": litellm_params.get("api_base"),
                "metadata": entry.get("model_info"),
            }
        )
    return {"data": out}


@app.get(
    "/api/tools",
    tags=["discovery"],
    summary="List dispatchable Tools",
    description=(
        "Returns the Tools the engine can dispatch (function-calling "
        "targets bound to the parent LLM). Some Tools wrap Agents — "
        "e.g. `research` is both a callable Tool here AND its own Agent "
        "on GET /api/agents. The response also reflects tool-host's "
        "own /v1/tools so operators can spot drift between what the "
        "engine exposes and what the executor implements."
    ),
)
async def list_tools() -> dict[str, Any]:
    """Return the tools the agent can dispatch.

    Source of truth is the local ALL_TOOLS registry (since that's what
    LangGraph would actually invoke), enriched with tool-host's own
    /v1/tools list so an operator can spot drift between what we expose
    and what the executor implements."""
    local = [
        {
            "name": t.name,
            "description": (t.description or "").strip(),
            "args_schema": (
                t.args_schema.model_json_schema()
                if t.args_schema is not None
                else None
            ),
        }
        for t in ALL_TOOLS.values()
    ]

    host_status: dict[str, Any] = {"reachable": False}
    try:
        async with httpx.AsyncClient(timeout=5) as ac:
            headers = (
                {"Authorization": f"Bearer {TOOL_HOST_API_KEY}"}
                if TOOL_HOST_API_KEY
                else {}
            )
            resp = await ac.get(f"{TOOL_HOST_URL}/v1/tools", headers=headers)
            if resp.status_code == 200:
                host_status = {"reachable": True, **resp.json()}
            else:
                host_status = {
                    "reachable": False,
                    "status_code": resp.status_code,
                }
    except httpx.HTTPError as exc:
        host_status = {"reachable": False, "error": str(exc)}

    return {"tools": local, "tool_host": host_status}


class AgentTopologyNodeOut(BaseModel):
    """One node in an Agent's LangGraph topology — wire format."""

    id: str = Field(description="Node identifier as LangGraph reports it.")
    type: Literal["start", "end", "agent", "tools"] = Field(
        description="Node kind. `agent` runs the LLM; `tools` dispatches tool calls; `start`/`end` are LangGraph terminals.",
    )
    config_schema: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "JSON Schema for this node's tunables (output of "
            "`config_model.model_json_schema()`). `null` for nodes "
            "without operator-tweakable knobs (start/end/tools). UI "
            'affordances ride in `properties.<field>.ui` (e.g. '
            '`{"widget": "model"}` or `{"step": 0.05}`).'
        ),
    )
    config_defaults: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "Materialised default values for this node's config (output "
            "of `config_model().model_dump()`). `null` when the node "
            "has no config_schema."
        ),
    )


class AgentTopologyEdgeOut(BaseModel):
    """One edge in an Agent's LangGraph topology — wire format."""

    source: str
    target: str
    conditional: bool = Field(
        default=False,
        description="True when the edge is a conditional-router edge (LangGraph's add_conditional_edges).",
    )


class AgentTopologyOut(BaseModel):
    nodes: list[AgentTopologyNodeOut]
    edges: list[AgentTopologyEdgeOut]


class AgentDescriptorOut(BaseModel):
    """One Agent in the registry — Engine tab consumes a list of these.

    Per-node config schemas live on `topology.nodes[].config_schema`
    (and `.config_defaults`). There is no Agent-level schema — every
    tunable is owned by the node that consumes it.
    """

    id: str = Field(description="Stable id used as the outer key in `agent_config` overrides.")
    description: str
    tools: list[str] = Field(
        default_factory=list,
        description="Tool names this Agent binds (cross-reference into /api/tools).",
    )
    topology: AgentTopologyOut


class ListAgentsResponse(BaseModel):
    agents: list[AgentDescriptorOut]


@app.get(
    "/api/agents",
    response_model=ListAgentsResponse,
    tags=["discovery"],
    summary="List registered Agents",
    description=(
        "Returns every Agent (compiled LangGraph state machine with its "
        "own LLM + loop) registered with the engine. Each entry carries:\n"
        "- `topology.nodes[]` — static node + edge snapshot for the "
        "Engine tab to render. Each node carries its own "
        "`config_schema` (JSON Schema from the node's Pydantic class) "
        "and `config_defaults` (materialised no-arg instance). Nodes "
        "without tunables (start/end/tools) have both fields null.\n\n"
        "Per-request overrides flow back via the `agent_config` field "
        "on `POST /api/chat/stream` — shape is "
        "`{<agent_id>: {<node_id>: {field: value, ...}, ...}, ...}`."
    ),
)
async def list_agents() -> ListAgentsResponse:
    """Return the Agents registered with the engine."""
    # Stable display order: `main` (the parent / top-level chat
    # agent) first, then everything else in insertion order. Without
    # this, Python's dict-iteration order leaks the module import
    # sequence into the UI (graph.py's `from .tools import get_tools`
    # triggers research's registration before main's), which surprises
    # operators who expect to find the top-level agent on top.
    preferred: list[str] = ["main"]
    seen: set[str] = set()
    ordered_ids = [aid for aid in preferred if aid in AGENTS]
    seen.update(ordered_ids)
    ordered_ids.extend(aid for aid in AGENTS if aid not in seen)

    out: list[AgentDescriptorOut] = []
    for aid in ordered_ids:
        desc = AGENTS[aid]
        out.append(
            AgentDescriptorOut(
                id=desc.id,
                description=desc.description,
                tools=list(desc.tools),
                topology=AgentTopologyOut(
                    nodes=[
                        AgentTopologyNodeOut(
                            id=n.id,
                            type=n.type,
                            config_schema=(
                                n.config_model.model_json_schema()
                                if n.config_model is not None
                                else None
                            ),
                            config_defaults=(
                                n.config_model().model_dump()
                                if n.config_model is not None
                                else None
                            ),
                        )
                        for n in desc.topology.nodes
                    ],
                    edges=[
                        AgentTopologyEdgeOut(
                            source=e.source,
                            target=e.target,
                            conditional=e.conditional,
                        )
                        for e in desc.topology.edges
                    ],
                ),
            )
        )
    return ListAgentsResponse(agents=out)


# ───────────────────────────────────────────────────────────────────────
# Observability — DuckDB event-trace browse / drill endpoints.
# Empty arrays when EVENTS_DB isn't set (store disabled), so consumers
# can treat them as always-safe to call.
# ───────────────────────────────────────────────────────────────────────


class RunSummaryOut(BaseModel):
    """One row per dispatched chat in the event store."""

    run_id: str
    started_at: float = Field(description="Epoch seconds of the first event.")
    finished_at: float = Field(description="Epoch seconds of the latest event.")
    total_events: int
    token_count: int = Field(description="Count of `token` events — proxy for response length.")
    tool_calls: int = Field(description="Count of `tool_call_start` events.")
    error_count: int = Field(description="Count of `error` events.")
    terminal_node: Optional[str] = Field(
        default=None,
        description="`node` tag on the last event — useful for filtering completed vs errored runs.",
    )
    model: Optional[str] = Field(default=None, description="Parent agent model id.")
    tools_json: Optional[str] = Field(
        default=None,
        description="JSON-encoded list of tools the parent was allowed to dispatch.",
    )
    agent_config_json: Optional[str] = Field(
        default=None,
        description="JSON-encoded agent_config snapshot from the request.",
    )


class ListRunsResponse(BaseModel):
    runs: list[RunSummaryOut]
    enabled: bool = Field(
        description="False when EVENTS_DB is unset and the store is a no-op.",
    )


class RunEventOut(BaseModel):
    """One event row from the trace."""

    run_id: str
    seq: int
    ts: float
    kind: str = Field(
        description="AgentEvent.type — `token`, `tool_call_start`, `message_done`, etc.",
    )
    node: Optional[str] = Field(
        default=None,
        description="Best-effort node attribution (`tool` name, `agent`, `start`, …).",
    )
    payload: dict[str, Any] = Field(
        description="Full event body, exactly as the SSE consumer received it.",
    )


class RunEventsResponse(BaseModel):
    events: list[RunEventOut]


@app.get(
    "/api/runs",
    tags=["observability"],
    response_model=ListRunsResponse,
    summary="List recent runs",
    description=(
        "Returns a summary row per chat dispatch the engine has seen, "
        "newest first. When the event store is disabled (no `EVENTS_DB`), "
        "`enabled=false` and `runs=[]`."
    ),
)
async def list_runs(limit: int = 100) -> ListRunsResponse:
    store = get_event_store()
    if store is None:
        return ListRunsResponse(runs=[], enabled=False)
    rows = store.runs(limit=limit)
    return ListRunsResponse(
        runs=[RunSummaryOut(**r) for r in rows],
        enabled=True,
    )


@app.get(
    "/api/runs/{run_id}",
    tags=["observability"],
    response_model=RunEventsResponse,
    summary="Get every event for a run",
    description=(
        "Returns the full ordered event list for a single run. Useful "
        "for replay UIs and debugging runaway loops."
    ),
)
async def get_run_events(run_id: str) -> RunEventsResponse:
    store = get_event_store()
    if store is None:
        return RunEventsResponse(events=[])
    rows = store.events_for(run_id)
    return RunEventsResponse(events=[RunEventOut(**r) for r in rows])


@app.get(
    "/api/runs/{run_id}/{seq}",
    tags=["observability"],
    response_model=RunEventOut,
    summary="Get one event by (run_id, seq)",
    description=(
        "Returns the single event row at the given sequence number — "
        "handy for replay-this-step UIs that need just one payload."
    ),
)
async def get_run_event(run_id: str, seq: int) -> RunEventOut:
    store = get_event_store()
    if store is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="event store disabled")
    row = store.get_event(run_id, seq)
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="event not found")
    return RunEventOut(**row)


def main() -> None:
    """Console entrypoint: `python -m catalyst_langgraph.server`."""
    import uvicorn

    port = int(os.environ.get("PORT", "7078"))
    uvicorn.run(
        "catalyst_langgraph.server:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
