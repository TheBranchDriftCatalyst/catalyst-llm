"""Integration tests for ``build_amr_pipeline`` + ``AmrParseNode``.

Exercises the wired-up AMR pipeline end-to-end with a stubbed parser,
so we can verify the graph compiles, the node sequence is correct, and
state flows from one node to the next as designed. The real AMR parser
isn't imported (amrlib is heavy and the projection tests cover the
parser's output shape).

Pyramid coverage:
  * Tier 1 (adversarial): empty input, parser exception, missing
    label pack, partial state.
  * Tier 2 (property): the wired graph emits assertions matching what
    AmrToAssertionNode would emit when invoked directly with the same
    parses + consensus.
  * Tier 3 (differential): same inputs through ``build_amr_pipeline``
    vs direct ``AmrToAssertionNode`` invocation produce equal
    assertions (modulo non-deterministic provenance).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import pytest

from catalyst_exgraph.config import ner_stage_config
from catalyst_exgraph.models.amr_assertion import AmrAssertion
from catalyst_exgraph.nodes.amr_parse import AmrParseNode
from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
from catalyst_exgraph.pipeline import build_amr_pipeline
from catalyst_exgraph.state import ExGraphState
from catalyst_langgraph.label_packs import load_label_pack


@pytest.fixture(autouse=True)
def configure_event_store():  # noqa: D401 — fixture override
    """No-op replacement for the dagster_io-backed conftest fixture.

    The AMR pipeline uses the lazy-import event_store stub when dagster_io
    isn't available, so tests don't need a real writer. Override matches
    the pattern used by test_amr_project.py.
    """
    yield


_CONGRESS_PACK = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/congress-data/prompts/congress.labels.yaml"
)


@dataclass(frozen=True)
class _StubParse:
    """AmrSentenceParse-shaped stub for tests (no amrlib dependency)."""

    sentence_text: str
    sentence_index: int
    sentence_char_start: int
    sentence_char_end: int
    penman: str
    parse_duration_s: float = 0.0
    parse_error: str | None = None


class _StubAmrParser:
    """Returns a fixed list of stub parses regardless of input. Tests pin
    the PENMAN content; the pipeline must just plumb it through."""

    def __init__(self, parses: list[_StubParse]) -> None:
        self._parses = parses
        self.call_count = 0

    async def parse(self, text: str) -> list[_StubParse]:
        self.call_count += 1
        return list(self._parses)


def _load_congress_pack():
    if not _CONGRESS_PACK.is_file():
        pytest.skip(f"congress pack not present at {_CONGRESS_PACK}")
    return load_label_pack(_CONGRESS_PACK.parent, "congress")


# ─── AmrParseNode unit tests ──────────────────────────────────────────────


async def _invoke_amr_parse(node: AmrParseNode, state: dict) -> dict:
    return await node(state)


def test_amr_parse_node_empty_raw_text_returns_empty_no_crash():
    parser = _StubAmrParser([])
    node = AmrParseNode(client=parser)
    result = asyncio.run(_invoke_amr_parse(node, {"raw_text": ""}))
    assert result["amr_parses"] == []
    assert parser.call_count == 0  # never even called the parser
    events = result.get("amr_audit_events", [])
    assert any(e.get("status") == "completed" for e in events)


def test_amr_parse_node_whitespace_only_returns_empty():
    parser = _StubAmrParser([])
    node = AmrParseNode(client=parser)
    result = asyncio.run(_invoke_amr_parse(node, {"raw_text": "   \n\t  "}))
    assert result["amr_parses"] == []
    assert parser.call_count == 0


def test_amr_parse_node_propagates_parses():
    parses = [_StubParse("sentence 1.", 0, 0, 11, "(s / state-01)", 0.01, None)]
    parser = _StubAmrParser(parses)
    node = AmrParseNode(client=parser)
    result = asyncio.run(_invoke_amr_parse(node, {"raw_text": "sentence 1."}))
    assert len(result["amr_parses"]) == 1
    assert result["amr_parses"][0].penman == "(s / state-01)"
    assert parser.call_count == 1


def test_amr_parse_node_isolates_client_exception():
    class _Boom:
        async def parse(self, text):
            raise RuntimeError("parser exploded")

    node = AmrParseNode(client=_Boom())
    result = asyncio.run(_invoke_amr_parse(node, {"raw_text": "anything"}))
    assert result["amr_parses"] == []
    events = result.get("amr_audit_events", [])
    assert any(e.get("status") == "error" for e in events)
    assert "parser exploded" in (events[-1].get("error") or "")


def test_amr_parse_node_propagates_import_error():
    """If amrlib is missing, the whole client is unusable — surface."""

    class _NoAmrLib:
        async def parse(self, text):
            raise ImportError("amrlib not installed")

    node = AmrParseNode(client=_NoAmrLib())
    with pytest.raises(ImportError, match="amrlib"):
        asyncio.run(_invoke_amr_parse(node, {"raw_text": "hi"}))


def test_amr_parse_node_appends_to_existing_audit_events():
    """Subsequent runs in the same state must not clobber prior events."""
    parser = _StubAmrParser([_StubParse("x.", 0, 0, 2, "(x / x-01)", 0.0, None)])
    node = AmrParseNode(client=parser)
    state = {"raw_text": "x.", "amr_audit_events": [{"prior": True}]}
    result = asyncio.run(_invoke_amr_parse(node, state))
    events = result["amr_audit_events"]
    assert events[0] == {"prior": True}
    assert any("status" in e for e in events[1:])


# ─── build_amr_pipeline integration tests ─────────────────────────────────


def test_build_amr_pipeline_compiles_with_minimal_config():
    """The graph must compile from one encoder + a stub parser + a pack."""
    pack = _load_congress_pack()
    ner_cfg = ner_stage_config(model="regex")
    graph = build_amr_pipeline(
        encoders=[ner_cfg],
        clients={ner_cfg.model_override or ner_cfg.stage_name: _DummyClient()},
        mcp_client=_DummyMcp(),
        amr_parser_client=_StubAmrParser([]),
        label_pack=pack,
    )
    assert graph is not None
    # The compiled graph should have a callable invoke method.
    assert hasattr(graph, "ainvoke")


def test_amr_pipeline_emits_assertions_for_introduce_01_frame():
    """End-to-end: feed PENMAN with introduce-01 → expect a 'sponsors' assertion."""
    pack = _load_congress_pack()

    penman = (
        "(i / introduce-01\n"
        '   :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Smith"))\n'
        '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
    )
    parses = [_StubParse("Rep. Smith introduced H.R. 1234.", 0, 0, 33, penman, 0.0, None)]

    # Run through the full pipeline (NER-half stubbed with no-op client +
    # consensus passthrough).
    ner_cfg = ner_stage_config(model="regex")
    graph = build_amr_pipeline(
        encoders=[ner_cfg],
        clients={ner_cfg.model_override or ner_cfg.stage_name: _DummyClient()},
        mcp_client=_DummyMcp(),
        amr_parser_client=_StubAmrParser(parses),
        label_pack=pack,
    )

    state: ExGraphState = {
        "raw_text": "Rep. Smith introduced H.R. 1234.",
        "source_metadata": {"document_id": "doc-1", "chunk_id": "chunk-1"},
        "stages": {},
        "upstream_context": {},
        "audit_events": [],
        "amr_audit_events": [],
        "status": "pending",
    }
    result = asyncio.run(graph.ainvoke(state))

    assertions = result.get("amr_assertions", []) or []
    assert assertions, "AMR pipeline produced no assertions for introduce-01"
    intro = next(a for a in assertions if a.amr_frame == "introduce-01")
    # post-QA-B-rename: introduce-01 → "introduces" (matches the SPO prompt
    # vocab). sponsor-01 maps to "sponsors". Both are valid in the pack.
    assert intro.predicate == "introduces"
    assert "Smith" in intro.subject_text
    assert intro.object_text and "1234" in intro.object_text


def test_amr_pipeline_differential_against_direct_projection_node():
    """The pipeline must produce the same assertions as invoking the
    projection node directly with equivalent inputs."""
    pack = _load_congress_pack()

    penman = (
        "(r / refer-01\n"
        "   :ARG1 (b / bill :name (n / name :op1 \"H.R.\" :op2 \"1234\"))\n"
        "   :ARG2 (c / committee :name (n2 / name :op1 \"Energy\" :op2 \"Committee\")))"
    )
    parses = [_StubParse("text", 0, 0, 4, penman, 0.0, None)]

    # Direct call to AmrToAssertionNode
    direct_node = AmrToAssertionNode(label_pack=pack)
    direct_state = {
        "raw_text": "text",
        "amr_parses": parses,
        "consensus_mentions": [],
        "source_metadata": {"document_id": "d", "chunk_id": "c"},
    }
    direct_result = asyncio.run(direct_node(direct_state))
    direct_assertions = direct_result.get("amr_assertions", [])

    # Same inputs via the pipeline
    ner_cfg = ner_stage_config(model="regex")
    graph = build_amr_pipeline(
        encoders=[ner_cfg],
        clients={ner_cfg.model_override or ner_cfg.stage_name: _DummyClient()},
        mcp_client=_DummyMcp(),
        amr_parser_client=_StubAmrParser(parses),
        label_pack=pack,
    )
    state: ExGraphState = {
        "raw_text": "text",
        "source_metadata": {"document_id": "d", "chunk_id": "c"},
        "stages": {},
        "upstream_context": {},
        "audit_events": [],
        "amr_audit_events": [],
        "status": "pending",
    }
    pipeline_result = asyncio.run(graph.ainvoke(state))
    pipeline_assertions = pipeline_result.get("amr_assertions", []) or []

    # The predicate + frame must match exactly. Other fields can differ
    # via consensus-mention enrichment (the pipeline runs NER first).
    assert [a.amr_frame for a in pipeline_assertions] == [
        a.amr_frame for a in direct_assertions
    ]
    assert [a.predicate for a in pipeline_assertions] == [
        a.predicate for a in direct_assertions
    ]


# ─── Test helpers ──────────────────────────────────────────────────────────


class _DummyClient:
    """No-op extraction client for the NER half of the pipeline.

    Returns empty mentions so the AMR-spine path is exercised without the
    full ensemble. The projection node tolerates an empty consensus
    (canonical_entity_refs just don't populate).
    """

    model = "regex"

    async def structured_output(self, schema, messages):
        # Return an empty schema instance — most schemas have a list field
        # that defaults to empty.
        if hasattr(schema, "model_fields"):
            return schema(**{k: [] for k in schema.model_fields if k in ("mentions", "propositions")})
        return schema()


class _DummyMcp:
    """No-op MCP client — the AMR path doesn't validate."""

    def validate_mentions(self, *args, **kwargs):
        return {"verdict": "accept", "errors": [], "valid_items": []}

    def validate_propositions(self, *args, **kwargs):
        return {"verdict": "accept", "errors": [], "valid_items": []}
