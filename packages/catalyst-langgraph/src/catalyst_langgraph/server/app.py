"""FastAPI app factory + OpenAPI tag schema.

Extracted from the original server.py during the llm-doh refactor.
The factory keeps CORS permissive for dev (playground hits us
cross-origin from :5174); tighten via ingress in prod.
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__


OPENAPI_TAGS: list[dict[str, str]] = [
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
    {
        "name": "observability",
        "description": (
            "DuckDB-backed event trace. Every SSE event the engine "
            "yields is mirrored into a queryable file (set via the "
            "`EVENTS_DB` env var) so operators can audit runs, debug "
            "runaway loops, and feed downstream cost / latency "
            "dashboards. When the env var is unset, the store is a "
            "no-op and these endpoints return empty lists."
        ),
    },
]


_APP_DESCRIPTION = (
    "LangGraph agent service. Owns the agent/tool loop; UIs consume "
    "a typed SSE event stream."
)


def make_app(*, lifespan: Any = None) -> FastAPI:
    """Build the FastAPI app for catalyst-langgraph.

    Wires permissive CORS (dev) and the standard OpenAPI tag schema.
    The caller passes in the lifespan contextmanager so this module
    stays free of EventStore/persistence imports.
    """
    app = FastAPI(
        title="catalyst-langgraph",
        version=__version__,
        openapi_tags=OPENAPI_TAGS,
        description=_APP_DESCRIPTION,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app
