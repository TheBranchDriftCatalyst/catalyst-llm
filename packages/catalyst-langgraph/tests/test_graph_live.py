"""Live integration smoke test for the agent graph.

Hits a real LiteLLM proxy + a real tool-host. Skipped unless both
LITELLM_BASE_URL and LITELLM_API_KEY are set in the env (and TOOL_HOST_URL
points at a reachable tool-host when tools are exercised).

Marker: integration (so `pytest -m unit` skips it).
"""
from __future__ import annotations

import os

import pytest
from langchain_core.messages import HumanMessage

LITELLM_OK = bool(os.environ.get("LITELLM_BASE_URL")) and bool(
    os.environ.get("LITELLM_API_KEY") or os.environ.get("LITE_LLM_KEY")
)
TOOL_HOST_OK = bool(os.environ.get("TOOL_HOST_URL"))

LIVE_MODEL = os.environ.get("LIVE_MODEL", "mac/qwen3-coder")


@pytest.mark.integration
@pytest.mark.skipif(not LITELLM_OK, reason="LITELLM_{BASE_URL,API_KEY} not set")
def test_live_graph_no_tools_returns_content() -> None:
    from catalyst_langgraph.graph import build_graph

    app = build_graph(model=LIVE_MODEL, tool_names=None, temperature=0)
    result = app.invoke({"messages": [HumanMessage(content="Say only the word PONG.")]})
    final = result["messages"][-1]
    assert final.content
    # Don't assert exact content — just that we got a non-empty answer.


@pytest.mark.integration
@pytest.mark.skipif(
    not (LITELLM_OK and TOOL_HOST_OK),
    reason="LITELLM and TOOL_HOST_URL must both be set",
)
def test_live_graph_with_web_search_threads_results() -> None:
    """Pose a question that should plausibly trigger web_search; assert
    a final assistant content message arrives. We accept either path
    (model decided to search or model answered directly) — the point
    is the loop terminates without erroring."""
    from catalyst_langgraph.graph import build_graph

    app = build_graph(
        model=LIVE_MODEL,
        tool_names=["web_search"],
        temperature=0,
        system_prompt=(
            "You can call web_search(query) when you need fresh facts. "
            "Otherwise answer directly. Be brief."
        ),
    )
    result = app.invoke(
        {"messages": [HumanMessage(content="What is the capital of France?")]}
    )
    final = result["messages"][-1]
    assert final.content, "agent ended with empty content"
