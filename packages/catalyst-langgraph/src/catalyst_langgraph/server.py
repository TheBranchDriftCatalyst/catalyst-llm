"""FastAPI entrypoint for catalyst-langgraph.

Today this only exposes /healthz so we can verify the package is wired
up end-to-end (deps installed, app boots, port reachable). Subsequent
issues add /api/chat/stream, /api/models, /api/tools — all hanging off
the same `app` instance below.

Run locally:
    python -m catalyst_langgraph.server
or:
    uvicorn catalyst_langgraph.server:app --reload --port 7078
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__

app = FastAPI(
    title="catalyst-langgraph",
    version=__version__,
    description=(
        "LangGraph agent service. Owns the agent/tool loop; UIs consume "
        "a typed SSE event stream."
    ),
)

# The playground (Vite dev server on localhost:5174 by default) calls
# this service from a different origin in dev. Keep the allowlist
# permissive for now — production will front this with an ingress that
# strips arbitrary origins anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness probe — used by k8s readinessProbe and `tilt up`."""
    return {"status": "ok", "service": "catalyst-langgraph", "version": __version__}


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
