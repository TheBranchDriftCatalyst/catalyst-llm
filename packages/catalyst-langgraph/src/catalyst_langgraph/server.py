"""FastAPI entrypoint for catalyst-langgraph.

Endpoints:
  GET  /healthz                Liveness probe.
  POST /api/chat/stream        SSE — typed agent events (see events.py).

/api/models and /api/tools land in a follow-up issue (llm-7li).

Run locally:
    python -m catalyst_langgraph.server
or:
    uvicorn catalyst_langgraph.server:app --reload --port 7078
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, AsyncIterator, Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

from . import __version__
from .client import CatalystLiteLLMClient
from .events import (
    AgentEvent,
    ChatStreamRequest,
    ErrorEvent,
    Iteration,
    MessageDone,
    RunStarted,
    Token,
    ToolCallEnd,
    ToolCallStart,
)
from .agents import AGENTS, validate_overrides
from .graph import build_graph
from .tools import ALL_TOOLS
from .tools.host import TOOL_HOST_API_KEY, TOOL_HOST_URL
from .tools.research import caller_context, research_overrides

log = logging.getLogger("catalyst-langgraph")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)


OPENAPI_TAGS = [
    {
        "name": "chat",
        "description": (
            "The main entry point: stream a chat completion as typed "
            "agent events (run_started, token, tool_call_start, "
            "tool_call_end, message_done, error). See "
            "[events.py](https://github.com/TheBranchDriftCatalyst/catalyst-llm) "
            "for the AgentEvent union."
        ),
    },
    {
        "name": "discovery",
        "description": (
            "What the engine can do: which models, which tools, "
            "which Agents (compiled LangGraph state machines). "
            "Drives the playground's pickers, the tool toggle, and "
            "the Engine tab's per-Agent config form."
        ),
    },
    {
        "name": "health",
        "description": "Liveness probes for k8s.",
    },
]


app = FastAPI(
    title="catalyst-langgraph",
    version=__version__,
    openapi_tags=OPENAPI_TAGS,
    description=(
        "LangGraph agent service. Owns the agent/tool loop; UIs consume "
        "a typed SSE event stream."
    ),
)

# Permissive CORS for dev — playground at localhost:5174 calls us from
# a different origin. Tighten via ingress in prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

    # Merge the new agent_config["main"] override channel over the
    # legacy `params` channel. Precedence: agent_config["main"] ⊃
    # params ⊃ defaults. Both stay supported so older clients without
    # agent_config still work.
    #
    # Per-agent values are validated through the Agent's Pydantic
    # config_model (`MainAgentConfig`, `ResearchAgentConfig`, …) so
    # bogus fields and wrong types are rejected here instead of
    # bubbling into LangGraph as silent type errors. validate_overrides
    # returns only the keys the operator explicitly set
    # (model_dump(exclude_unset=True)) — we never pin defaults into the
    # override dict.
    agent_config_raw = request.agent_config or {}
    try:
        main_overrides = validate_overrides(
            "main", agent_config_raw.get("main") or {}
        )
        validated_research = validate_overrides(
            "research", agent_config_raw.get("research") or {}
        )
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
        research_overrides.reset(research_overrides_token)
        caller_context.reset(caller_context_token)
        return

    state = {"messages": _coerce_messages(request.messages)}

    iteration = 0
    tool_starts: dict[str, tuple[str, float]] = {}  # run_id → (name, started_at)
    last_usage: Optional[dict[str, Any]] = None
    last_finish: Optional[str] = None

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
                    yield Token(content=content)

            elif kind == "on_chat_model_end":
                # LangChain stashes usage + finish in different places
                # depending on provider; pull the common shape and fall
                # back gracefully.
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
                yield ToolCallStart(id=tcid, name=name, args=args)

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
                yield ToolCallEnd(id=tcid, result=result, duration_ms=duration_ms)
    except Exception as exc:
        log.exception("agent stream errored")
        yield ErrorEvent(message=str(exc))
        return
    finally:
        # Always reset the ContextVars — leaving them set would leak
        # the previous request's config / context into the next one
        # running in this worker.
        research_overrides.reset(research_overrides_token)
        caller_context.reset(caller_context_token)

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


@app.get(
    "/healthz",
    tags=["health"],
    summary="Liveness probe",
)
def healthz() -> dict[str, str]:
    """Liveness probe — used by k8s readinessProbe and `tilt up`."""
    return {"status": "ok", "service": "catalyst-langgraph", "version": __version__}


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
    """One Agent in the registry — Engine tab consumes a list of these."""

    id: str = Field(description="Stable id used as the key in `agent_config` overrides.")
    description: str
    tools: list[str] = Field(
        default_factory=list,
        description="Tool names this Agent binds (cross-reference into /api/tools).",
    )
    topology: AgentTopologyOut
    config_schema: dict[str, Any] = Field(
        description=(
            "JSON Schema for this Agent's tunables (output of "
            "`config_model.model_json_schema()`). UI affordances ride "
            'in `properties.<field>.ui` (e.g. `{"widget": "model"}` or '
            '`{"step": 0.05}`).'
        ),
    )


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
        "- `topology` — static node + edge snapshot for the Engine tab "
        "to render.\n"
        "- `config_schema` — JSON Schema of the Agent's tunables, "
        "produced by the Agent's Pydantic config class. UI hints ride "
        "in the `ui` extension key on each property.\n\n"
        "Per-request overrides flow back via the `agent_config` field "
        "on `POST /api/chat/stream`."
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
                        AgentTopologyNodeOut(id=n.id, type=n.type)
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
                config_schema=desc.config_model.model_json_schema(),
            )
        )
    return ListAgentsResponse(agents=out)


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
