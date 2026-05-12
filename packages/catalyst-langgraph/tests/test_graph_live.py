"""Live integration smoke test for the agent graph.

Hits a real LiteLLM proxy + a real tool-host. Skipped unless both
LITELLM_BASE_URL and LITELLM_API_KEY are set in the env (and TOOL_HOST_URL
points at a reachable tool-host when tools are exercised).

Parametrised across a small model matrix so we catch per-model
regressions on the basic graph + web_search surface. Add new rows to
`_DEFAULT_MODELS`; mark known-bad rows in `_KNOWN_BAD_MODELS` (mirrors
the test_research_live.py convention).

Operators can override per-run:
  LIVE_MODEL=mac/phi4 pytest ...                    # single model
  LIVE_MODELS=mac/phi4,mac/qwen3-coder pytest ...   # csv override

Marker: integration (so `pytest -m unit` skips it).
"""
from __future__ import annotations

import os

import pytest
from langchain_core.messages import HumanMessage

LITELLM_OK = bool(os.environ.get("LITELLM_BASE_URL")) and bool(
    os.environ.get("LITELLM_API_KEY")
)
TOOL_HOST_OK = bool(os.environ.get("TOOL_HOST_URL"))

# Default model matrix for the basic graph + web_search surface.
# Both rows are tool-callers on talos00's LiteLLM. mac/phi4 is here
# specifically because it was the original llm-gbp bug surface
# (called web_search 5x with the same query and produced no answer
# on the old TS agent loop). On the LangGraph backend it now
# terminates cleanly — leave it in so the row catches any future
# regression of the same kind. mac/qwen3-coder is included as the
# repo's default local tool-caller.
_DEFAULT_MODELS = [
    "mac/qwen3-coder",
    "mac/phi4",
]

# Models we know fail today on this surface. Empty for now: both
# default rows pass. Pattern mirrors test_research_live.py — if a
# model regresses, add it here with a one-line reason and the row
# will XFAIL rather than break CI.
_KNOWN_BAD_MODELS: dict[str, str] = {}

# Env overrides:
#   LIVE_MODEL — single model, replaces the matrix entirely (legacy
#                shape so existing operator runs keep working)
#   LIVE_MODELS — comma-separated list, also replaces the matrix
_OVERRIDE = os.environ.get("LIVE_MODELS") or os.environ.get("LIVE_MODEL")
TEST_MODELS = (
    [m.strip() for m in _OVERRIDE.split(",") if m.strip()]
    if _OVERRIDE
    else list(_DEFAULT_MODELS)
)


def _model_params() -> list:
    return [
        pytest.param(
            m,
            marks=(
                pytest.mark.xfail(reason=_KNOWN_BAD_MODELS[m], strict=False)
                if m in _KNOWN_BAD_MODELS
                else ()
            ),
        )
        for m in TEST_MODELS
    ]


@pytest.mark.integration
@pytest.mark.skipif(not LITELLM_OK, reason="LITELLM_{BASE_URL,API_KEY} not set")
@pytest.mark.parametrize("model", _model_params())
def test_live_graph_no_tools_returns_content(model: str) -> None:
    from catalyst_langgraph.graph import build_graph

    app = build_graph(model=model, tool_names=None, temperature=0)
    result = app.invoke({"messages": [HumanMessage(content="Say only the word PONG.")]})
    final = result["messages"][-1]
    assert final.content
    # Don't assert exact content — just that we got a non-empty answer.


@pytest.mark.integration
@pytest.mark.skipif(
    not (LITELLM_OK and TOOL_HOST_OK),
    reason="LITELLM and TOOL_HOST_URL must both be set",
)
@pytest.mark.parametrize("model", _model_params())
def test_live_graph_with_web_search_threads_results(model: str) -> None:
    """Pose a question that should plausibly trigger web_search; assert
    a final assistant content message arrives. We accept either path
    (model decided to search or model answered directly) — the point
    is the loop terminates without erroring.

    This is the surface where the original llm-gbp bug bit phi4 on the
    old TS agent loop (5x web_search, no answer). On the LangGraph
    backend it now terminates."""
    from catalyst_langgraph.graph import build_graph

    app = build_graph(
        model=model,
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
