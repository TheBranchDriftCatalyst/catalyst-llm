"""Tests for AmrToAssertionNode — AMR-graph → unified Assertion projection.

Uses hand-written PENMAN strings (no amrlib dependency in tests). Each
test mocks the upstream ``AmrSentenceParse`` records and a tiny in-memory
``LabelPack`` with a focused ``amr_frames`` table.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from catalyst_contracts_core import Assertion
from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
from catalyst_langgraph.label_packs.loader import AmrFrames, LabelPack


# Override the conftest's autouse event_store fixture so these tests
# don't require dagster_io. The AMR-projection node already guards its
# event_store import with a no-op fallback, so we don't need the real
# event store here — we assert on returned audit events instead.
@pytest.fixture(autouse=True)
def configure_event_store():  # noqa: D401 — fixture override
    """No-op replacement for the dagster_io-backed conftest fixture."""
    yield


# ---------------------------------------------------------------------------
# Lightweight AmrSentenceParse stand-in (matches the dataclass fields the
# node reads). Avoids importing catalyst_langgraph.clients.amr_parser so the
# test never tries to touch amrlib.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FakeAmrParse:
    sentence_text: str
    sentence_index: int
    sentence_char_start: int
    sentence_char_end: int
    penman: str
    parse_duration_s: float = 0.0
    parse_error: str | None = None


SIMPLE_INTRODUCE = """
(i / introduce-01
   :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Smith"))
   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))
"""

NEGATED_REPORT = """
(r / report-01
   :polarity -
   :ARG0 (c / committee :name (n / name :op1 "Energy" :op2 "and" :op3 "Commerce"))
   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))
"""

CONDITIONAL_BECOME = """
(b / become-01
   :ARG1 (b2 / bill)
   :ARG2 (l / law)
   :condition (s / sign-01
                 :ARG0 (p / person :ARG0-of (h / have-org-role-91
                                                :ARG2 (r / role :name (n / name :op1 "President"))))
                 :ARG1 b2))
"""

HAVE_ORG_ROLE = """
(h / have-org-role-91
   :ARG0 (p / person :name (n / name :op1 "Jane" :op2 "Doe"))
   :ARG1 (o / organization :name (n2 / name :op1 "Senate"))
   :ARG2 (r / role :name (n3 / name :op1 "Chair")))
"""

MODAL_POSSIBLE = """
(v / vote-01
   :mode possible
   :ARG0 (p / person :name (n / name :op1 "Smith"))
   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))
"""

EMPTY_GRAPH = "(d / dummy-thing)"

NO_FRAME_GRAPH = "(p / person :name (n / name :op1 \"Alice\"))"


def _pack(
    frames: dict[str, str] | None = None,
    unknown_frame_action: str = "novel",
    role_overrides: dict[str, dict[str, str]] | None = None,
) -> LabelPack:
    """Build a minimal LabelPack carrying only the amr_frames section."""
    return LabelPack(
        name="test-pack",
        amr_frames=AmrFrames(
            frames=frames or {},
            unknown_frame_action=unknown_frame_action,
            role_overrides=role_overrides or {},
        ),
    )


def _state(
    parses: list[FakeAmrParse],
    consensus_mentions: list[dict] | None = None,
    raw_text: str = "",
    doc_id: str = "doc-amr",
) -> dict:
    return {
        "raw_text": raw_text,
        "doc_id": doc_id,
        "source_metadata": {"document_id": doc_id},
        "amr_parses": parses,
        "consensus_mentions": consensus_mentions or [],
        "stages": {},
        "audit_events": [],
        "status": "pending",
    }


# ---------------------------------------------------------------------------
# Core projection behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_basic_introduce_projects_subject_predicate_object():
    """introduce-01 → AmrAssertion with subject containing Smith and object containing H.R. 1234."""
    sentence = "Rep. Smith introduced H.R. 1234."
    parses = [
        FakeAmrParse(
            sentence_text=sentence,
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=len(sentence),
            penman=SIMPLE_INTRODUCE,
        )
    ]
    pack = _pack(frames={"introduce-01": "sponsored"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, raw_text=sentence))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert isinstance(a, Assertion)
    assert a.predicate == "sponsored"
    assert "Smith" in a.subject_text
    assert a.object_text is not None
    assert "H.R." in a.object_text and "1234" in a.object_text
    assert a.amr_frame == "introduce-01"
    assert a.amr_variable == "i"
    assert a.polarity is True
    assert a.is_novel_predicate is False
    assert a.confidence == 1.0
    assert a.sentence_index == 0


@pytest.mark.asyncio
async def test_negated_report_sets_polarity_false():
    """report-01 with :polarity - projects polarity=False on the assertion."""
    sentence = "The Energy and Commerce Committee did not report H.R. 1234."
    parses = [
        FakeAmrParse(
            sentence_text=sentence,
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=len(sentence),
            penman=NEGATED_REPORT,
        )
    ]
    pack = _pack(frames={"report-01": "reported_out"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, raw_text=sentence))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert a.predicate == "reported_out"
    assert a.polarity is False
    assert "Energy" in a.subject_text
    assert a.object_text is not None
    assert "1234" in a.object_text


@pytest.mark.asyncio
async def test_modal_attribute_projects_modality():
    """vote-01 with :mode possible projects modality='possible'."""
    parses = [
        FakeAmrParse(
            sentence_text="Smith might vote on H.R. 1234.",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=32,
            penman=MODAL_POSSIBLE,
        )
    ]
    pack = _pack(frames={"vote-01": "voted_on"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    assert assertions[0].modality == "possible"


# ---------------------------------------------------------------------------
# Unknown-frame action behaviours
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_frame_novel_emits_prefixed_predicate():
    """Frames missing from the pack with action='novel' emit NOVEL_{frame}."""
    parses = [
        FakeAmrParse("x", 0, 0, 1, SIMPLE_INTRODUCE),
    ]
    pack = _pack(frames={}, unknown_frame_action="novel")  # introduce-01 missing

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert a.predicate == "NOVEL_introduce-01"
    assert a.is_novel_predicate is True
    assert a.amr_frame == "introduce-01"
    assert a.confidence < 1.0


@pytest.mark.asyncio
async def test_unknown_frame_passthrough_uses_raw_frame():
    """action='passthrough' emits the frame text as the canonical predicate."""
    parses = [
        FakeAmrParse("x", 0, 0, 1, SIMPLE_INTRODUCE),
    ]
    pack = _pack(frames={}, unknown_frame_action="passthrough")

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert a.predicate == "introduce-01"
    assert a.is_novel_predicate is False
    assert a.confidence < 1.0


@pytest.mark.asyncio
async def test_unknown_frame_drop_emits_no_assertion():
    """action='drop' produces no assertion for the unknown frame."""
    parses = [
        FakeAmrParse("x", 0, 0, 1, SIMPLE_INTRODUCE),
    ]
    pack = _pack(frames={}, unknown_frame_action="drop")

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assert result["amr_assertions"] == []
    # An audit event must still record the drop so it isn't silent.
    dropped_events = [e for e in result["amr_audit_events"] if e["status"] == "dropped"]
    assert len(dropped_events) == 1
    assert dropped_events[0]["amr_frame"] == "introduce-01"


# ---------------------------------------------------------------------------
# role_overrides
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_role_overrides_for_have_org_role_91_qualifier_lands_correctly():
    """have-org-role-91 with override {ARG0: subject, ARG1: object, ARG2: role}
    routes ARG2 to qualifiers['role'], not to object_text."""
    parses = [
        FakeAmrParse(
            sentence_text="Jane Doe chairs the Senate.",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=27,
            penman=HAVE_ORG_ROLE,
        )
    ]
    pack = _pack(
        frames={"have-org-role-91": "holds_role"},
        role_overrides={
            "have-org-role-91": {
                "ARG0": "subject",
                "ARG1": "object",
                "ARG2": "role",
            }
        },
    )

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert a.predicate == "holds_role"
    assert "Jane" in a.subject_text
    assert a.object_text is not None
    assert "Senate" in a.object_text
    # ARG2 → "role" semantic slot → qualifiers, NOT object.
    assert "role" in a.qualifiers
    assert "Chair" in a.qualifiers["role"]
    # The applied role mapping should be preserved on the assertion.
    assert a.amr_role_mapping == {"ARG0": "subject", "ARG1": "object", "ARG2": "role"}


# ---------------------------------------------------------------------------
# Qualifiers from adjunct edges
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_condition_edge_lands_in_qualifiers():
    """A :condition adjunct on the top frame projects into qualifiers['condition']."""
    parses = [
        FakeAmrParse(
            sentence_text="The bill becomes law if the President signs it.",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=47,
            penman=CONDITIONAL_BECOME,
        )
    ]
    pack = _pack(frames={"become-01": "becomes", "sign-01": "signs"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    # become-01 is the top predicate; sign-01 is nested under :condition.
    by_frame = {a.amr_frame: a for a in result["amr_assertions"]}
    assert "become-01" in by_frame
    become_a = by_frame["become-01"]
    # :condition edge → qualifiers
    assert "condition" in become_a.qualifiers
    # The resolved surface for the condition is the sign-01 concept itself
    # (since sign-01 has no :name). That's fine — qualifier is non-empty.
    assert become_a.qualifiers["condition"]


# ---------------------------------------------------------------------------
# Parse-error + empty + no-frame edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parse_error_sentence_emits_no_assertion_but_records_audit():
    """A sentence with parse_error set yields zero assertions and one audit event."""
    parses = [
        FakeAmrParse(
            sentence_text="garbled text",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=12,
            penman="",
            parse_error="RuntimeError: parser exploded",
        )
    ]
    pack = _pack(frames={"introduce-01": "sponsored"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assert result["amr_assertions"] == []
    skipped = [e for e in result["amr_audit_events"] if e["status"] == "skipped"]
    assert len(skipped) == 1
    assert skipped[0]["reason"] == "parse_error"
    assert "parser exploded" in skipped[0]["parse_error"]


@pytest.mark.asyncio
async def test_empty_amr_parses_returns_empty_assertion_list():
    """No parses → no assertions, no crash."""
    pack = _pack(frames={"introduce-01": "sponsored"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([]))

    assert result["amr_assertions"] == []
    assert result["amr_audit_events"] == []


@pytest.mark.asyncio
async def test_graph_with_no_predicate_frames_returns_empty_assertions():
    """A PENMAN graph with only nominal concepts (no PropBank frames) emits no assertions."""
    parses = [
        FakeAmrParse(
            sentence_text="Alice.",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=6,
            penman=NO_FRAME_GRAPH,
        )
    ]
    pack = _pack(frames={})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assert result["amr_assertions"] == []


@pytest.mark.asyncio
async def test_undecodable_penman_emits_decode_error_audit():
    """A malformed PENMAN string is caught and surfaced as an audit event."""
    parses = [
        FakeAmrParse(
            sentence_text="bad",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=3,
            penman="(((this is not penman",
        )
    ]
    pack = _pack(frames={})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assert result["amr_assertions"] == []
    errors = [e for e in result["amr_audit_events"] if e["status"] == "error"]
    assert len(errors) == 1
    assert errors[0]["node_name"] == "amr_decode_failed"


# ---------------------------------------------------------------------------
# amr_role_mapping preservation + consensus entity resolution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_amr_role_mapping_default_is_preserved():
    """When no override is configured the default ARG0=subject / ARG1=object mapping
    is recorded on the assertion."""
    parses = [
        FakeAmrParse("x", 0, 0, 1, SIMPLE_INTRODUCE),
    ]
    pack = _pack(frames={"introduce-01": "sponsored"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    a = result["amr_assertions"][0]
    assert a.amr_role_mapping == {"ARG0": "subject", "ARG1": "object"}


@pytest.mark.asyncio
async def test_consensus_mention_match_populates_canonical_entity_refs():
    """A consensus mention matching the surface form pulls in its canonical id."""
    sentence = "Rep. Smith introduced H.R. 1234."
    parses = [
        FakeAmrParse(
            sentence_text=sentence,
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=len(sentence),
            penman=SIMPLE_INTRODUCE,
        )
    ]
    consensus = [
        {
            "mention_id": "ent-smith-001",
            "text": "Rep. Smith",
            "span_start": 0,
            "span_end": 10,
        },
        {
            "mention_id": "ent-hr1234",
            "text": "H.R. 1234",
            "span_start": 22,
            "span_end": 31,
        },
    ]
    pack = _pack(frames={"introduce-01": "sponsored"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, consensus_mentions=consensus, raw_text=sentence))

    a = result["amr_assertions"][0]
    # Both args should resolve to consensus mention ids on the unified
    # Assertion's scalar mention-id fields (replaces the old dict).
    assert {a.subject_mention_id, a.object_mention_id} == {"ent-smith-001", "ent-hr1234"}


@pytest.mark.asyncio
async def test_consensus_match_is_scoped_to_sentence_char_range():
    """A consensus mention in a different sentence must not bleed into this one."""
    parses = [
        FakeAmrParse(
            sentence_text="Sentence one.",
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=13,
            penman=SIMPLE_INTRODUCE,
        )
    ]
    consensus = [
        # mention sits past the sentence range → must be filtered out.
        {
            "mention_id": "ent-out-of-range",
            "text": "Smith",
            "span_start": 100,
            "span_end": 105,
        },
    ]
    pack = _pack(frames={"introduce-01": "sponsored"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, consensus_mentions=consensus))

    a = result["amr_assertions"][0]
    assert a.subject_mention_id is None
    assert a.object_mention_id is None


# ---------------------------------------------------------------------------
# Multi-sentence sanity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_multiple_parses_emit_multiple_assertions_with_correct_sentence_index():
    """Two parses yield two assertions, each tagged with its sentence_index."""
    parses = [
        FakeAmrParse("s0", 0, 0, 10, SIMPLE_INTRODUCE),
        FakeAmrParse("s1", 1, 20, 30, NEGATED_REPORT),
    ]
    pack = _pack(frames={"introduce-01": "sponsored", "report-01": "reported_out"})

    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert len(assertions) == 2
    by_idx = {a.sentence_index: a for a in assertions}
    assert by_idx[0].predicate == "sponsored"
    assert by_idx[0].sentence_char_start == 0
    assert by_idx[1].predicate == "reported_out"
    assert by_idx[1].polarity is False
    assert by_idx[1].sentence_char_start == 20
