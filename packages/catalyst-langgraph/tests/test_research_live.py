"""End-to-end integration tests for the research sub-agent.

Hits real LiteLLM + tool-host (real SearXNG + headless browser) +
real Ollama (or cloud, depending on which model is under test).
Parametrised across a curated list of models so we can quickly see
which models actually survive the pipeline under realistic
conditions — useful when picking council member / critic / fusion
defaults from the model zoo.

Two scopes:

  - `test_research_shallow_dispatches_and_returns_content` — the
    `depth="shallow"` single-agent bypass: one researcher graph,
    web_search bound, no fusion. Fast (<30s) and the path 99% of
    UI-driven research calls take. Always runs when env is set.

  - `test_research_deep_council_consolidates` — the full
    `depth="deep"` council fan-out + fusion. Slow (~30-90s per
    model) so it's opt-in via INCLUDE_DEEP=1; covers the path that
    exercises critic / fusion / async.gather.

Markers: `integration` (so `pytest -m unit` skips). Skipped if
LITELLM_BASE_URL + LITELLM_API_KEY + TOOL_HOST_URL aren't set.

Env knobs:
  - RESEARCH_TEST_MODELS — comma-separated model ids. Default is a
    curated 2-pick set (one cloud, one local Ollama tool-caller).
  - INCLUDE_DEEP — non-empty to opt into the slow deep-council test.
  - RESEARCH_TEST_QUERY — override the test question. Default is a
    short, stable factual prompt that always has SearXNG-findable
    sources.
"""
from __future__ import annotations

import asyncio
import os

import pytest


LITELLM_OK = bool(os.environ.get("LITELLM_BASE_URL")) and bool(
    os.environ.get("LITELLM_API_KEY") or os.environ.get("LITE_LLM_KEY")
)
TOOL_HOST_OK = bool(os.environ.get("TOOL_HOST_URL"))

# Default model matrix: one cloud + one Ollama local tool-caller.
# Cloud baseline catches "is the Feynman prompt at least valid?";
# Ollama row catches "does the streaming-tool-call gate still
# survive on a local model?" (the regression class that bit us when
# we shipped the council).
#
# Operators can override per-run:
#   RESEARCH_TEST_MODELS=mac/qwen3-8b,mac/glm-4.5-air pytest -m integration tests/test_research_live.py
_DEFAULT_MODELS = [
    "claude-haiku-4-5-20251001",
    "mac/qwen3-coder",
]
TEST_MODELS = [
    m.strip()
    for m in os.environ.get(
        "RESEARCH_TEST_MODELS", ",".join(_DEFAULT_MODELS)
    ).split(",")
    if m.strip()
]

INCLUDE_DEEP = bool(os.environ.get("INCLUDE_DEEP"))

# A factual query with stable, SearXNG-findable sources. Avoid
# anything time-sensitive ("what's the latest X?") since the test
# would fail flakily as the world changes underneath the search index.
TEST_QUERY = os.environ.get(
    "RESEARCH_TEST_QUERY",
    "What is LangGraph and who maintains it? One short paragraph.",
)


def _looks_like_feynman_draft(text: str) -> tuple[bool, list[str]]:
    """Soft structural check for the Feynman prompt's signal.

    We don't grade content quality — that's a model-eval problem,
    not a unit-test problem. We just check the prompt actually fired:
      - has *some* substance (not just an error string)
      - shows at least one of the two Feynman markers we explicitly
        instruct the model to emit: an inline citation or a `Gaps:`
        section.

    Returns `(passed, missing_signals)`. A model that fails both
    markers but does call the tool successfully indicates the prompt
    needs more weight; the test reports which signal is missing so
    the operator can investigate.
    """
    lowered = text.lower()
    signals = {
        "has_citation": ("source:" in lowered) or ("http" in text),
        "has_gaps": ("gaps:" in lowered) or ("gap:" in lowered),
        "has_substance": len(text.strip()) > 120,
    }
    missing = [k for k, ok in signals.items() if not ok]
    passed = signals["has_substance"] and (
        signals["has_citation"] or signals["has_gaps"]
    )
    return passed, missing


def _run_research(*, query: str, depth: str, overrides: dict) -> str:
    """Helper: set per-request overrides, invoke the research tool,
    reset overrides. asyncio.run() per test keeps event loops simple
    without requiring pytest-asyncio as a dep."""
    from catalyst_langgraph.tools.research import research, research_overrides

    token = research_overrides.set(overrides)
    try:
        return asyncio.run(
            research.ainvoke({"query": query, "depth": depth})
        )
    finally:
        research_overrides.reset(token)


@pytest.mark.integration
@pytest.mark.skipif(
    not (LITELLM_OK and TOOL_HOST_OK),
    reason="LITELLM_{BASE_URL,API_KEY} + TOOL_HOST_URL must all be set",
)
@pytest.mark.parametrize("model", TEST_MODELS)
def test_research_shallow_dispatches_and_returns_content(model: str) -> None:
    """`depth="shallow"` — single-agent bypass should produce a
    well-formed answer with Feynman markers.

    Pins the model + a tight recursion budget so a runaway tool loop
    can't hang the suite. The shallow path uses `cfg.model` for the
    researcher; we override that here so the parametrized model is
    actually what gets called (otherwise we'd just test the default
    every iteration).
    """
    result = _run_research(
        query=TEST_QUERY,
        depth="shallow",
        overrides={"model": model, "recursion_limit": 12},
    )

    assert isinstance(result, str), f"expected str, got {type(result).__name__}"
    assert result.strip(), f"empty research result for {model}"

    # The tool returns `[research failed: ...]` placeholders on
    # graceful failure (recursion limit, network blip, etc.) —
    # surface those as a real test failure with the underlying
    # message so the operator knows why the model didn't make it.
    if result.strip().startswith("research failed:"):
        pytest.fail(f"research failed for {model}: {result[:300]}")

    passed, missing = _looks_like_feynman_draft(result)
    if not passed:
        pytest.fail(
            "shallow research output lacks structural Feynman signals.\n"
            f"  model: {model}\n"
            f"  missing: {missing}\n"
            f"  output (first 600 chars): {result[:600]}"
        )


@pytest.mark.integration
@pytest.mark.skipif(
    not (LITELLM_OK and TOOL_HOST_OK and INCLUDE_DEEP),
    reason="set INCLUDE_DEEP=1 to run the (slow) council path",
)
@pytest.mark.parametrize("model", TEST_MODELS)
def test_research_deep_council_consolidates(model: str) -> None:
    """`depth="deep"` — full council (N=2) + fusion. Slow path.

    Council size pinned to 2 (not 1) so the fusion node actually
    fires; critic_enabled=False so we don't compound the wall-clock
    with critique rounds. The test is about "does the fan-out +
    fuse mechanism produce SOMETHING coherent under this model" —
    not "is critic-guided iteration converging".

    Recursion budget kept tight to bound wall-clock per member.
    With qwen3-coder this can still take 60-90s per parametrised
    run; mark as slow / skip by default.
    """
    result = _run_research(
        query=TEST_QUERY,
        depth="deep",
        overrides={
            "model": model,
            "fusion_model": model,
            "council_size": 2,
            "critic_enabled": False,
            "recursion_limit": 12,
        },
    )

    assert isinstance(result, str)
    assert result.strip(), f"empty deep-research result for {model}"

    if result.strip().startswith("research failed:"):
        pytest.fail(f"deep research failed for {model}: {result[:300]}")

    passed, missing = _looks_like_feynman_draft(result)
    if not passed:
        pytest.fail(
            "deep council output lacks structural Feynman signals.\n"
            f"  model: {model}\n"
            f"  missing: {missing}\n"
            f"  output (first 600 chars): {result[:600]}"
        )
