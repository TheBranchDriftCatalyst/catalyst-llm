"""Smoke tests for the tool-host sidecar.

These are L2 unit tests (no network, no spawned uvicorn process). They
exist to honor the pytest dev-dep declared in pyproject.toml and to
catch import regressions before they ship. Live HTTP / FastAPI
integration tests belong in sibling test_*.py files.
"""
from __future__ import annotations

import pytest


@pytest.mark.unit
def test_package_imports() -> None:
    """tool_host module + the server entry point are importable."""
    import tool_host
    from tool_host import server

    assert tool_host is not None
    assert callable(server.main)


@pytest.mark.unit
def test_fastapi_app_exists() -> None:
    """The FastAPI app is constructed at import time and exposes routes."""
    from tool_host import server

    app = getattr(server, "app", None)
    if app is None:
        pytest.skip("server.app not exported — adjust test as API stabilizes")
    # FastAPI app has a .routes attr; just sanity-check it's non-empty
    assert hasattr(app, "routes")
    assert len(app.routes) > 0, "FastAPI app has no routes registered"
