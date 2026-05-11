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
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
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
from .graph import build_graph
from .tools.host import ALL_TOOLS, TOOL_HOST_API_KEY, TOOL_HOST_URL

log = logging.getLogger("catalyst-langgraph")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)


app = FastAPI(
    title="catalyst-langgraph",
    version=__version__,
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

    params = request.params or {}
    extra_kwargs = {
        k: v
        for k, v in params.items()
        if k not in ("temperature", "max_tokens")
    }
    try:
        app_graph = build_graph(
            model=request.model,
            tool_names=request.tools or None,
            system_prompt=request.system_prompt,
            temperature=params.get("temperature", 0.7),
            max_tokens=params.get("max_tokens"),
            extra_model_kwargs=extra_kwargs or None,
        )
    except Exception as exc:  # bad model / config / wiring
        log.exception("graph build failed")
        yield ErrorEvent(message=f"graph build failed: {exc}")
        return

    state = {"messages": _coerce_messages(request.messages)}

    iteration = 0
    tool_starts: dict[str, tuple[str, float]] = {}  # run_id → (name, started_at)
    last_usage: Optional[dict[str, Any]] = None
    last_finish: Optional[str] = None

    try:
        async for ev in app_graph.astream_events(state, version="v2"):
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


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness probe — used by k8s readinessProbe and `tilt up`."""
    return {"status": "ok", "service": "catalyst-langgraph", "version": __version__}


@app.post("/api/chat/stream")
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


@app.get("/api/models")
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


@app.get("/api/tools")
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
