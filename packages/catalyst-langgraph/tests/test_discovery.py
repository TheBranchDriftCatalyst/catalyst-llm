"""Unit tests for /api/models and /api/tools.

Both endpoints proxy upstream services (LiteLLM and tool-host) so we
mock the network calls and assert the response shape the UI consumes.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.unit
def test_list_models_combines_models_and_info() -> None:
    from catalyst_langgraph.server import app

    fake_models = ["gpt-4o", "mac/qwen3-coder"]
    fake_info = [
        {
            "model_name": "gpt-4o",
            "litellm_params": {"model": "openai/gpt-4o", "api_base": "https://api.openai.com"},
            "model_info": {"input_cost_per_token": 0.000005},
        },
        # mac/qwen3-coder intentionally missing from /model/info to
        # cover the "model id without metadata" path.
    ]

    with patch(
        "catalyst_langgraph.server.CatalystLiteLLMClient"
    ) as MockClient:
        instance = MockClient.return_value
        instance.get_models.return_value = fake_models
        instance.get_model_info.return_value = fake_info
        client = TestClient(app)
        resp = client.get("/api/models")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert {m["id"] for m in data} == {"gpt-4o", "mac/qwen3-coder"}
    gpt = next(m for m in data if m["id"] == "gpt-4o")
    assert gpt["underlying_model"] == "openai/gpt-4o"
    assert gpt["api_base"] == "https://api.openai.com"
    assert gpt["metadata"]["input_cost_per_token"] == 0.000005
    qwen = next(m for m in data if m["id"] == "mac/qwen3-coder")
    assert qwen["underlying_model"] is None
    assert qwen["metadata"] is None


@pytest.mark.unit
def test_list_tools_returns_local_registry_and_marks_host_unreachable() -> None:
    """Without a real tool-host running, the host_status block should
    surface that fact rather than failing the whole request."""
    from catalyst_langgraph.server import app

    client = TestClient(app)
    resp = client.get("/api/tools")
    assert resp.status_code == 200
    body = resp.json()
    names = {t["name"] for t in body["tools"]}
    assert "web_search" in names
    web = next(t for t in body["tools"] if t["name"] == "web_search")
    assert web["description"]
    # tool-host isn't running in unit tests — endpoint should report
    # unreachable rather than 500.
    assert body["tool_host"]["reachable"] is False
