"""Liveness probe — used by k8s readinessProbe and `tilt up`.

Extracted from server.py during the llm-doh refactor. Exposed as an
APIRouter so the main app composes it via `include_router`.
"""
from __future__ import annotations

from fastapi import APIRouter

from .. import __version__

health_router = APIRouter()


@health_router.get(
    "/healthz",
    tags=["health"],
    summary="Liveness probe",
)
def healthz() -> dict[str, str]:
    """Liveness probe — used by k8s readinessProbe and `tilt up`."""
    return {"status": "ok", "service": "catalyst-langgraph", "version": __version__}
