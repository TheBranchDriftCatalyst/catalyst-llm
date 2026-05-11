"""Smoke tests for the FastAPI app."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.mark.unit
def test_healthz_ok() -> None:
    from catalyst_langgraph.server import app

    client = TestClient(app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "catalyst-langgraph"
    assert body["version"]
