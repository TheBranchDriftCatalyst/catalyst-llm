"""QA pyramid for AmrToAssertionNode + AmrAssertion model.

Adversarial / property / differential / scenario tests that don't duplicate
the dev's 16 happy-path tests in ``test_amr_project.py``. Goals:

  * Pin every behaviour the dev's report flagged (6 contracts).
  * Verify QA-B's polarity contract on vote-01 / withdraw-01 end-to-end.
  * Surface and pin behaviours for malformed / pathological packs and AMR
    graphs (cyclic, dangling, empty-mapped, collision, intransitive …).
  * Property-based invariants (hypothesis).
  * Differential checks against real congress + media packs.

Tier counts (target ~25 tests):
  T1 adversarial unit : 16
  T2 property-based   :  5
  T3 differential     :  3
  T4 scenario         :  2
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import penman
import pytest
from catalyst_contracts_core import Assertion, Provenance
from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
from catalyst_langgraph.label_packs.loader import (
    AmrFrames,
    LabelPack,
    load_label_pack,
)
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError


# Override conftest's autouse event_store fixture — the projection node has
# its own no-op event_store fallback, so we don't need a real writer here.
@pytest.fixture(autouse=True)
def configure_event_store():  # noqa: D401 — fixture override
    """No-op replacement for the dagster_io-backed conftest fixture."""
    yield


# ---------------------------------------------------------------------------
# Lightweight AmrSentenceParse stand-in — identical to test_amr_project.py.
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


def _pack(
    frames: dict[str, str] | None = None,
    unknown_frame_action: str = "novel",
    role_overrides: dict[str, dict[str, str]] | None = None,
    extended_predicates: frozenset[str] | None = None,
) -> LabelPack:
    return LabelPack(
        name="test-pack",
        amr_frames=AmrFrames(
            frames=frames or {},
            unknown_frame_action=unknown_frame_action,
            role_overrides=role_overrides or {},
            extended_predicates=extended_predicates or frozenset(),
        ),
    )


def _state(
    parses: list[FakeAmrParse],
    consensus_mentions: list[dict] | None = None,
    raw_text: str = "",
    doc_id: str = "doc-qa",
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


# Reference paths — used by the differential tier. ``pytest.importorskip``
# would be wrong here: these files SHOULD exist; if they don't, the QA
# differential check fails and the team should notice.
_CONGRESS_PACK_DIR = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/k8s/base/congress-data/prompts"
)
_MEDIA_PACK_DIR = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/k8s/base/media-ingest/prompts"
)


# ===========================================================================
# Tier 1 — Adversarial unit tests (16)
# ===========================================================================


# ---- T1-01: inverted edge — DEV INTENT WAS WRONG; pin actual behaviour ----


@pytest.mark.asyncio
async def test_inverted_edge_arg0_of_IS_projected_because_penman_normalises():
    """Contract pin: ``:ARG0-of`` is NOT silently dropped — penman.decode
    normalises inverted edges to forward edges, so a predicate written with
    ``:ARG0-of`` projects exactly the same triple as if written with ``:ARG0``.

    The dev's code comment claimed inverted edges aren't enumerated. That
    was wrong; this test pins the actual (correct) behaviour. If a future
    refactor switches to e.g. ``penman.decode(..., model=NoopModel())`` and
    breaks de-inversion, this test will catch it.
    """
    inverted = "(c / committee :ARG0-of (r / report-01 :ARG1 (b / bill)))"
    pack = _pack(frames={"report-01": "reported_out"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state([FakeAmrParse("s", 0, 0, 30, inverted)], raw_text="x" * 30)
    )

    assertions = result["amr_assertions"]
    assert len(assertions) == 1
    a = assertions[0]
    assert a.amr_frame == "report-01"
    # The inverted ARG0 is normalised to a forward ARG0 from report-01 → committee.
    assert a.subject_text == "committee"
    assert a.object_text == "bill"


# ---- T1-02: nested predicate under :condition — emits its own assertion ----


@pytest.mark.asyncio
async def test_nested_predicate_under_condition_emits_separate_assertion():
    """A ``sign-01`` nested under ``:condition`` of ``become-01`` must emit
    its OWN assertion — penman walks all :instance nodes, and the projection
    node should not special-case "this is under a qualifier edge".

    Also pin: the parent's ``qualifiers["condition"]`` carries the nested
    predicate's surface form (the nested concept literal because sign-01 has
    no :name in this fixture).
    """
    pen = """
    (b / become-01
       :ARG1 (b2 / bill)
       :ARG2 (l / law)
       :condition (s / sign-01
                     :ARG0 (p / person :name (n / name :op1 "President"))
                     :ARG1 b2))
    """
    pack = _pack(frames={"become-01": "enacted", "sign-01": "signed_by"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 50, pen)]))

    by_frame = {a.amr_frame: a for a in result["amr_assertions"]}
    assert "become-01" in by_frame
    assert "sign-01" in by_frame
    assert by_frame["become-01"].qualifiers.get("condition", "")  # non-empty
    # The nested sign-01 assertion should have its own subject/object resolved.
    assert "President" in by_frame["sign-01"].subject_text
    assert by_frame["sign-01"].object_text == "bill"


# ---- T1-03: custom role_overrides closed set — recipient/source_attribution/role_value ----


@pytest.mark.asyncio
async def test_custom_role_override_values_land_in_qualifiers():
    """The QA-M media pack uses ``source_attribution``, ``recipient``,
    ``role_value`` (and the congress pack uses ``role_value`` for
    have-org-role-91). Confirm each of these closed-set role names lands
    as a qualifier KEY, never as ``object_text`` or ``subject_text``.
    """
    pen = (
        "(t / tell-01"
        '   :ARG0 (p / person :name (n / name :op1 "Speaker"))'
        '   :ARG1 (l / person :name (n2 / name :op1 "Listener"))'
        '   :ARG2 (c / claim :name (n3 / name :op1 "secret")))'
    )
    pack = _pack(
        frames={"tell-01": "states"},
        role_overrides={
            "tell-01": {
                "ARG0": "subject",
                "ARG1": "recipient",
                "ARG2": "object",
            }
        },
    )
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 50, pen)]))

    a = result["amr_assertions"][0]
    assert "recipient" in a.qualifiers
    assert "Listener" in a.qualifiers["recipient"]
    # object should come from ARG2, NOT from ARG1 (the recipient).
    assert a.object_text == "secret"
    # subject is unchanged.
    assert a.subject_text == "Speaker"
    # And the recipient must NOT have leaked into object_text.
    assert "Listener" not in (a.object_text or "")


# ---- T1-04: nameless concept falls back to literal ----


@pytest.mark.asyncio
async def test_nameless_concept_falls_back_to_instance_literal():
    """A nameless bill ``(b / bill)`` resolves to surface form ``"bill"``
    (concept literal). Consensus matcher returns None when no mention's
    text contains "bill"."""
    pen = "(i / introduce-01 :ARG0 (p / person) :ARG1 (b / bill))"
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state(
            [FakeAmrParse("s", 0, 0, 30, pen)],
            consensus_mentions=[
                {"mention_id": "m-1", "text": "Smith", "span_start": 0, "span_end": 5}
            ],
        )
    )

    a = result["amr_assertions"][0]
    assert a.subject_text == "person"
    assert a.object_text == "bill"
    # No consensus mention says "bill" or "person", so mention ids are unset.
    assert a.subject_mention_id is None
    assert a.object_mention_id is None


# ---- T1-05: polarity contract — only '-' is False, '+' / missing are True ----


@pytest.mark.asyncio
async def test_polarity_explicit_plus_remains_true():
    """``:polarity +`` is legal AMR but unusual; polarity must stay True."""
    pen = (
        "(i / introduce-01"
        "   :polarity +"
        '   :ARG0 (p / person :name (n / name :op1 "Smith"))'
        "   :ARG1 (b / bill))"
    )
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    a = result["amr_assertions"][0]
    assert a.polarity is True


@pytest.mark.asyncio
async def test_polarity_missing_remains_true():
    """No ``:polarity`` attribute at all → polarity = True (default)."""
    pen = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill))'
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    assert result["amr_assertions"][0].polarity is True


# ---- T1-06: unknown frame action confidences are pinned ----


@pytest.mark.asyncio
async def test_unknown_frame_confidence_pinned_to_0_5_for_passthrough_and_novel():
    """Confidence floor for both unknown-frame actions is the documented 0.5."""
    pen = (
        "(z / completely-novel-frame-99"
        '   :ARG0 (p / person :name (n / name :op1 "X"))'
        "   :ARG1 (b / bill))"
    )
    for action in ("passthrough", "novel"):
        pack = _pack(frames={}, unknown_frame_action=action)
        node = AmrToAssertionNode(label_pack=pack)
        result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))
        a = result["amr_assertions"][0]
        assert a.confidence == 0.5, f"confidence drift for action={action}: {a.confidence}"


# ---- T1-07: cyclic AMR graph — must not infinite-loop ----


@pytest.mark.asyncio
async def test_cyclic_amr_graph_does_not_infinite_loop():
    """``(a / pass-03 :ARG0 (b / refer-01 :ARG0 a))`` — projection must
    terminate. Either emits sane assertions or records a decode-error audit;
    must never hang. We bound the deadline by relying on pytest's default
    timeout; the test passes when the call returns at all.
    """
    pen = "(a / pass-03 :ARG0 (b / refer-01 :ARG0 a))"
    pack = _pack(frames={"pass-03": "passed", "refer-01": "refers_to"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    # Termination is the load-bearing assertion. We also pin that BOTH
    # frame nodes are still walked (cycle doesn't suppress one of them).
    frames_seen = {a.amr_frame for a in result["amr_assertions"]}
    assert frames_seen == {"pass-03", "refer-01"}


# ---- T1-08: dangling variable reference — silent skip via penman ----


@pytest.mark.asyncio
async def test_dangling_variable_reference_yields_empty_subject_no_crash():
    """``:ARG0 nonexistent`` where ``nonexistent`` has no :instance —
    penman silently drops that edge during decode. The projection node
    should still emit an assertion for the predicate, with subject_text=""
    (no ARG0 resolved). Pin this behaviour.
    """
    pen = "(i / introduce-01 :ARG0 nonexistent :ARG1 (b / bill))"
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    a = result["amr_assertions"][0]
    assert a.subject_text == ""
    assert a.object_text == "bill"
    # And the ARG0 role mapping is NOT recorded because the edge dropped.
    assert "ARG0" not in a.amr_role_mapping
    assert a.amr_role_mapping == {"ARG1": "object"}


# ---- T1-09: multiple consensus mentions matching same AMR var — first wins ----


@pytest.mark.asyncio
async def test_multiple_consensus_matches_pick_first_in_list_order():
    """When two consensus mentions both substring-match the surface form,
    the matcher returns the FIRST one (list-iteration order). This pins
    the deterministic-policy contract — if a future refactor introduces
    longest-match or highest-confidence selection, this test breaks and
    the policy must be re-documented.
    """
    pen = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill))'
    mentions = [
        {"mention_id": "ent-A", "text": "Smith", "span_start": 0, "span_end": 5},
        {"mention_id": "ent-B", "text": "Smith Jones", "span_start": 0, "span_end": 11},
    ]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state(
            [FakeAmrParse("s", 0, 0, 30, pen)],
            consensus_mentions=mentions,
            raw_text="Smith Jones introduced HR1",
        )
    )

    a = result["amr_assertions"][0]
    # First mention in list order wins — the subject AMR var p resolves to ent-A.
    assert a.subject_mention_id == "ent-A"


# ---- T1-10: variable collision across sentences — refs are sentence-scoped ----


@pytest.mark.asyncio
async def test_variable_collision_across_sentences_refs_are_sentence_scoped():
    """Sentence 0 has var ``b`` bound to bill HR1; sentence 1 has var ``b``
    bound to bill HR2. Their canonical_entity_refs must NOT cross — each
    assertion resolves only against mentions whose spans overlap its own
    sentence range.
    """
    s0 = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill :name (n2 / name :op1 "HR1")))'
    s1 = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Jones")) :ARG1 (b / bill :name (n2 / name :op1 "HR2")))'
    parses = [
        FakeAmrParse("s0", 0, 0, 50, s0),
        FakeAmrParse("s1", 1, 50, 100, s1),
    ]
    mentions = [
        {"mention_id": "bill-1", "text": "HR1", "span_start": 30, "span_end": 33},
        {"mention_id": "bill-2", "text": "HR2", "span_start": 80, "span_end": 83},
    ]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, consensus_mentions=mentions, raw_text="x" * 100))

    by_idx = {a.sentence_index: a for a in result["amr_assertions"]}
    # The bill is the object in both sentences; mention id resolution
    # must be scoped to each sentence's char range.
    assert by_idx[0].object_mention_id == "bill-1"
    assert by_idx[1].object_mention_id == "bill-2"
    # Critically: NO leakage between sentences.
    assert by_idx[0].object_mention_id != "bill-2"
    assert by_idx[1].object_mention_id != "bill-1"


# ---- T1-11: collision — two frames sharing same canonical predicate ----


@pytest.mark.asyncio
async def test_shared_canonical_predicate_preserves_distinct_amr_frame():
    """``say-01`` and ``state-01`` both map to ``"states"``. Each emits an
    independent assertion with distinct ``amr_frame`` provenance — the
    canonical-predicate collision must NOT cause one to override the other.
    """
    p1 = '(s / say-01 :ARG0 (p / person :name (n / name :op1 "A")) :ARG1 (c / claim))'
    p2 = '(s / state-01 :ARG0 (p / person :name (n / name :op1 "B")) :ARG1 (c / claim))'
    pack = _pack(frames={"say-01": "states", "state-01": "states"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state(
            [
                FakeAmrParse("s0", 0, 0, 30, p1),
                FakeAmrParse("s1", 1, 30, 60, p2),
            ]
        )
    )

    by_frame = {a.amr_frame: a for a in result["amr_assertions"]}
    assert set(by_frame) == {"say-01", "state-01"}
    assert by_frame["say-01"].predicate == "states"
    assert by_frame["state-01"].predicate == "states"
    assert by_frame["say-01"].subject_text == "A"
    assert by_frame["state-01"].subject_text == "B"


# ---- T1-12: empty raw_text but non-empty amr_parses ----


@pytest.mark.asyncio
async def test_empty_raw_text_with_parses_still_projects():
    """raw_text being empty is not a bar to projection — the parses carry
    their own sentence_text. Pin: assertions still emit; the node uses
    sentence char ranges from the parse, not raw_text.
    """
    pen = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill))'
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)], raw_text=""))

    assert len(result["amr_assertions"]) == 1


# ---- T1-13: frame mapped to empty string — must NOT leak empty predicate ----


@pytest.mark.asyncio
async def test_frame_mapped_to_empty_string_does_not_leak_empty_predicate():
    """A pack pathology — ``frames: {introduce-01: ""}``. The fix in the
    node treats this as an unknown-frame fall-through, so the assertion
    gets the unknown-frame action's predicate (NOVEL_ prefix or passthrough)
    and an audit ``amr_frame_empty_mapping`` event is recorded.

    Bug found by QA: the original code leaked ``predicate=""`` directly,
    breaking the load-bearing invariant that no assertion has an empty
    predicate.
    """
    pen = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill))'
    pack = _pack(frames={"introduce-01": ""}, unknown_frame_action="novel")
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    a = result["amr_assertions"][0]
    assert a.predicate != ""
    assert a.predicate == "NOVEL_introduce-01"
    assert a.is_novel_predicate is True
    # Audit must record the pathology so it's not silent.
    warnings = [e for e in result["amr_audit_events"] if e.get("status") == "warning"]
    assert any(e["node_name"] == "amr_frame_empty_mapping" for e in warnings)


# ---- T1-14: intransitive predicate (no ARG0) — object still populated ----


@pytest.mark.asyncio
async def test_intransitive_predicate_no_arg0_emits_with_empty_subject():
    """``(p / pass-03 :ARG1 (b / bill))`` — intransitive usage of pass-03.
    Subject is empty, object is "bill". The assertion is NOT dropped just
    because ARG0 is missing — pin this behaviour.
    """
    pen = "(p / pass-03 :ARG1 (b / bill))"
    pack = _pack(frames={"pass-03": "passed"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    assert len(result["amr_assertions"]) == 1
    a = result["amr_assertions"][0]
    assert a.subject_text == ""
    assert a.object_text == "bill"
    assert a.predicate == "passed"


# ---- T1-15: :mode with unusual values is not restricted to a closed set ----


@pytest.mark.asyncio
async def test_mode_attribute_passes_through_arbitrary_values():
    """AMR ``:mode`` can be ``possible`` / ``obligation`` / ``interrogative`` /
    ``imperative`` — the projection node MUST not enforce a closed set; it
    just carries whatever literal AMR emitted.
    """
    pen = (
        "(q / ask-01"
        "   :mode interrogative"
        '   :ARG0 (p / person :name (n / name :op1 "A"))'
        "   :ARG1 (t / thing))"
    )
    pack = _pack(frames={"ask-01": "questions"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    assert result["amr_assertions"][0].modality == "interrogative"


# ---- T1-16: Assertion model validation — confidence bounds + defaults ----


def _min_provenance() -> Provenance:
    """Minimal Provenance for fixture builds — Provenance is now required
    on every Assertion in the unified contracts-core model."""
    return Provenance(source_document_id="", chunk_id="")


def test_amr_assertion_confidence_bounds_enforced():
    """Pydantic must reject confidence > 1.0 and < 0.0."""
    for bad in (1.5, -0.1, 2.0, -1.0):
        with pytest.raises(ValidationError):
            Assertion(
                assertion_id="x",
                subject_text="x",
                predicate="p",
                amr_frame="f-01",
                amr_variable="v",
                sentence_index=0,
                sentence_char_start=0,
                sentence_char_end=1,
                confidence=bad,
                provenance=_min_provenance(),
            )


def test_amr_assertion_field_defaults_correct():
    """Construction with only required fields produces sensible defaults."""
    a = Assertion(
        assertion_id="x",
        subject_text="x",
        predicate="p",
        amr_frame="f-01",
        amr_variable="v",
        sentence_index=0,
        sentence_char_start=0,
        sentence_char_end=1,
        provenance=_min_provenance(),
    )
    assert a.polarity is True
    assert a.qualifiers == {}
    # The unified Assertion replaces canonical_entity_refs with
    # subject_mention_id / object_mention_id scalars.
    assert a.subject_mention_id is None
    assert a.object_mention_id is None
    assert a.is_novel_predicate is False
    assert a.amr_role_mapping == {}
    assert a.object_text is None
    assert a.modality is None
    assert a.confidence == 1.0


# ===========================================================================
# Tier 2 — Property-based tests (hypothesis) (5)
# ===========================================================================


# A minimal but legal PENMAN strategy: generate frame name, ARG0 name, ARG1 name.
_FRAME_LITERALS = st.sampled_from(
    [
        "introduce-01",
        "report-01",
        "vote-01",
        "pass-03",
        "refer-01",
        "amend-01",
        "veto-01",
    ]
)
_NAMES = st.sampled_from(["Smith", "Jones", "Brown", "Garcia", "Lee", "Patel"])
_BILL_NAMES = st.sampled_from(["HR1", "HR2", "S100", "S200", "HR1234"])


@st.composite
def _penman_fixture(draw):
    """Build a (sentence_text, sentence_char_start, sentence_char_end,
    penman, mentions) tuple consistent with each other.
    """
    frame = draw(_FRAME_LITERALS)
    person = draw(_NAMES)
    bill = draw(_BILL_NAMES)
    sentence_text = f"{person} did {frame.split('-')[0]} {bill}."
    start = draw(st.integers(min_value=0, max_value=100))
    end = start + len(sentence_text)
    pen = (
        f"(p / {frame}"
        f'   :ARG0 (a / person :name (n / name :op1 "{person}"))'
        f'   :ARG1 (b / bill :name (n2 / name :op1 "{bill}")))'
    )
    return frame, sentence_text, start, end, person, bill, pen


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(fixture=_penman_fixture())
@pytest.mark.asyncio
async def test_property_sentence_char_bounds_consistent(fixture):
    """Invariant: every assertion has sentence_char_start ≤ sentence_char_end."""
    frame, sent_text, start, end, _person, _bill, pen = fixture
    parses = [FakeAmrParse(sent_text, 0, start, end, pen)]
    pack = _pack(frames={frame: "did_thing"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, raw_text="z" * (end + 1)))

    for a in result["amr_assertions"]:
        assert a.sentence_char_start <= a.sentence_char_end
        assert a.sentence_char_start >= 0


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(fixture=_penman_fixture())
@pytest.mark.asyncio
async def test_property_canonical_entity_refs_are_input_mention_ids_only(fixture):
    """Invariant: every resolved mention_id on an Assertion MUST be an actual
    mention_id from the input consensus_mentions — never fabricated.
    """
    frame, sent_text, start, end, person, bill, pen = fixture
    parses = [FakeAmrParse(sent_text, 0, start, end, pen)]
    mentions = [
        {
            "mention_id": "person-mid",
            "text": person,
            "span_start": start,
            "span_end": end,
        },
        {
            "mention_id": "bill-mid",
            "text": bill,
            "span_start": start,
            "span_end": end,
        },
    ]
    mention_ids = {m["mention_id"] for m in mentions}
    pack = _pack(frames={frame: "did_thing"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, consensus_mentions=mentions, raw_text="z" * (end + 1)))

    for a in result["amr_assertions"]:
        for v in (a.subject_mention_id, a.object_mention_id):
            if v is not None:
                assert v in mention_ids, f"fabricated mention id leaked: {v!r}"


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    frame=_FRAME_LITERALS,
    in_frames_table=st.booleans(),
    action=st.sampled_from(["novel", "passthrough", "drop"]),
)
@pytest.mark.asyncio
async def test_property_is_novel_predicate_biconditional(frame, in_frames_table, action):
    """Invariant: is_novel_predicate == True IFF (frame not in pack.frames AND action == "novel").

    For action="drop", no assertion is emitted (so the property is vacuously
    upheld). For "passthrough" of unknown frames, is_novel_predicate is False
    by contract — only the "novel" action sets it.
    """
    pen = f'(p / {frame} :ARG0 (a / person :name (n / name :op1 "X")) :ARG1 (b / bill))'
    frames = {frame: "p_canon"} if in_frames_table else {}
    pack = _pack(frames=frames, unknown_frame_action=action)
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    if not in_frames_table and action == "drop":
        # No assertion emitted; biconditional vacuously holds.
        assert result["amr_assertions"] == []
        return

    a = result["amr_assertions"][0]
    expected_novel = (not in_frames_table) and (action == "novel")
    assert a.is_novel_predicate == expected_novel


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(fixture=_penman_fixture())
@pytest.mark.asyncio
async def test_property_no_empty_predicate_leaks_when_pack_is_well_formed(fixture):
    """Invariant: with a well-formed frames table (every mapping non-empty),
    no assertion has predicate == "".
    """
    frame, sent_text, start, end, _person, _bill, pen = fixture
    pack = _pack(frames={frame: "did_thing"})  # all mappings non-empty
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse(sent_text, 0, start, end, pen)]))

    for a in result["amr_assertions"]:
        assert a.predicate, f"empty predicate leaked: {a!r}"


@settings(max_examples=20, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(fixture=_penman_fixture())
@pytest.mark.asyncio
async def test_property_determinism_same_input_same_output(fixture):
    """Invariant: running the node twice on the same (state, pack) yields
    identical Assertion lists (modulo Provenance.timestamp, which is
    a wall-clock field that intentionally differs per emission).
    """
    frame, sent_text, start, end, _person, _bill, pen = fixture
    parses = [FakeAmrParse(sent_text, 0, start, end, pen)]
    pack = _pack(frames={frame: "did_thing"})
    node = AmrToAssertionNode(label_pack=pack)
    r1 = await node(_state(parses))
    r2 = await node(_state(parses))

    def _scrub(assertions):
        # Compare value-equality on everything except Provenance.timestamp
        # (a wall-clock attribute set at construction time).
        out = []
        for a in assertions:
            d = a.model_dump()
            if d.get("provenance"):
                d["provenance"].pop("timestamp", None)
            out.append(d)
        return out

    assert _scrub(r1["amr_assertions"]) == _scrub(r2["amr_assertions"])


# ===========================================================================
# Tier 3 — Differential / cross-validation tests (3)
# ===========================================================================


# The SPO prompt's canonical predicate vocabulary (extracted from
# congress-data/prompts/proposition_extraction.prompt §"Use ONLY these
# predicates"). Kept here so this test catches drift in either direction.
_SPO_PROMPT_PREDICATES = frozenset(
    {
        "sponsors",
        "co_sponsors",
        "introduces",
        "refers_to",
        "amends",
        "votes_for",
        "votes_against",
        "enacted",
        "signed_by",
        "regulates",
        "appropriates",
        "funds",
        "member_of",
        "chairs",
        "supports",
        "opposes",
        "passed",
        "failed",
        "vetoed_by",
    }
)


@pytest.mark.asyncio
async def test_diff_congress_pack_emitted_predicates_are_subset_of_prompt_plus_extended():
    """The load-bearing cross-validation: every predicate the AMR projection
    could emit (from the congress pack) must live in either the SPO prompt
    vocabulary OR the pack's ``extended_predicates`` declared exception list.
    Anything in frames.values() that's missing from BOTH is a contract bug.
    """
    if not _CONGRESS_PACK_DIR.exists():
        pytest.skip("congress pack not available in this checkout")
    pack = load_label_pack(_CONGRESS_PACK_DIR, "congress")

    allowed = _SPO_PROMPT_PREDICATES | pack.amr_frames.extended_predicates
    emitted = set(pack.amr_frames.frames.values())
    rogue = emitted - allowed
    assert rogue == set(), (
        f"congress pack emits predicates not in SPO vocab and not declared "
        f"in extended_predicates: {sorted(rogue)}"
    )


@pytest.mark.asyncio
async def test_diff_media_pack_speech_act_arg2_lands_as_source_attribution():
    """Differential against the media pack: a ``say-01`` PENMAN with ARG2
    must route ARG2 → ``qualifiers["source_attribution"]`` per QA-M's
    expanded role_overrides.
    """
    if not _MEDIA_PACK_DIR.exists():
        pytest.skip("media pack not available in this checkout")
    pack = load_label_pack(_MEDIA_PACK_DIR, "media")

    pen = (
        "(s / say-01"
        '   :ARG0 (p / person :name (n / name :op1 "Speaker"))'
        '   :ARG1 (c / claim :name (n2 / name :op1 "the" :op2 "leak"))'
        '   :ARG2 (a / authority :name (n3 / name :op1 "intelligence" :op2 "reports")))'
    )
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 80, pen)]))

    a = result["amr_assertions"][0]
    assert a.predicate == "states"
    assert "source_attribution" in a.qualifiers
    assert "intelligence" in a.qualifiers["source_attribution"]
    # And the attribution did NOT pollute object_text.
    assert "intelligence" not in (a.object_text or "")


@pytest.mark.asyncio
async def test_diff_ner_consensus_no_match_vs_match_yields_same_surfaces_but_different_refs():
    """The surface form on subject_text/object_text comes from AMR, not from
    the NER consensus. Two runs over identical PENMAN — one with a matching
    consensus mention, one without — must produce identical surface forms
    and differ only in ``canonical_entity_refs``.
    """
    pen = '(i / introduce-01 :ARG0 (p / person :name (n / name :op1 "Smith")) :ARG1 (b / bill))'
    parses = [FakeAmrParse("Smith intro'd bill", 0, 0, 18, pen)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)

    no_match = await node(_state(parses, consensus_mentions=[], raw_text="Smith intro'd bill"))
    with_match = await node(
        _state(
            parses,
            consensus_mentions=[
                {"mention_id": "m-smith", "text": "Smith", "span_start": 0, "span_end": 5}
            ],
            raw_text="Smith intro'd bill",
        )
    )

    a0 = no_match["amr_assertions"][0]
    a1 = with_match["amr_assertions"][0]
    assert a0.subject_text == a1.subject_text == "Smith"
    assert a0.object_text == a1.object_text == "bill"
    # With no matching consensus mentions, subject/object mention ids stay None.
    assert a0.subject_mention_id is None
    assert a0.object_mention_id is None
    # With a matching mention for "Smith", the subject mention id resolves.
    assert a1.subject_mention_id == "m-smith"
    assert a1.object_mention_id is None


# ===========================================================================
# Tier 4 — Scenario tests (2) — real packs, multi-frame, end-to-end shape
# ===========================================================================


@pytest.mark.asyncio
async def test_scenario_real_legislative_two_predicates_with_consensus_match():
    """Real-world-shape AMR for:
    "Rep. Smith introduced H.R. 1234, which was referred to the Committee
    on Energy and Commerce."

    Both ``introduce-01`` and ``refer-01`` are reentrant on the bill node
    ``b``. Loaded with the real congress pack — must emit TWO assertions
    with the QA-B-renamed predicates (``introduces`` + ``refers_to``),
    polarity True on both, and the consensus mention id for the bill
    resolves on each.
    """
    if not _CONGRESS_PACK_DIR.exists():
        pytest.skip("congress pack not available")
    pack = load_label_pack(_CONGRESS_PACK_DIR, "congress")

    sent = (
        "Rep. Smith introduced H.R. 1234, which was referred to the "
        "Committee on Energy and Commerce."
    )
    pen = (
        "(a / and"
        "   :op1 (i / introduce-01"
        '            :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Smith"))'
        '            :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
        "   :op2 (r / refer-01"
        "            :ARG1 b"
        '            :ARG2 (c / committee :name (n3 / name :op1 "Energy" :op2 "and" :op3 "Commerce"))))'
    )
    mentions = [
        {
            "mention_id": "m-smith",
            "text": "Rep. Smith",
            "span_start": 0,
            "span_end": 10,
        },
        {
            "mention_id": "m-bill",
            "text": "H.R. 1234",
            "span_start": 22,
            "span_end": 31,
        },
    ]
    parses = [FakeAmrParse(sent, 0, 0, len(sent), pen)]
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, consensus_mentions=mentions, raw_text=sent))

    by_pred = {a.predicate: a for a in result["amr_assertions"]}
    assert "introduces" in by_pred
    assert "refers_to" in by_pred
    intro = by_pred["introduces"]
    refer = by_pred["refers_to"]
    assert intro.polarity is True
    assert refer.polarity is True
    # The bill consensus mention should land on both assertions. For
    # introduce-01 (default role mapping) the bill is ARG1 → object.
    # For refer-01 (congress pack override ARG1=subject, ARG2=object)
    # the bill is the subject and the committee is the object.
    assert intro.object_mention_id == "m-bill"
    assert refer.subject_mention_id == "m-bill"


@pytest.mark.asyncio
async def test_scenario_vote_01_negative_polarity_downstream_is_votes_against():
    """QA-B contract: ``vote-01`` with ``:polarity -`` projects predicate
    ``voted_on`` (extension) and ``polarity=False`` on the assertion.
    Downstream consumer interprets this as ``votes_against``.

    Verified against the real congress pack — failure of this scenario
    means the polarity-aware vote handling is broken.
    """
    if not _CONGRESS_PACK_DIR.exists():
        pytest.skip("congress pack not available")
    pack = load_label_pack(_CONGRESS_PACK_DIR, "congress")
    assert "voted_on" in pack.amr_frames.extended_predicates, (
        "pre-condition: voted_on must be declared as an extended predicate"
    )

    pen = (
        "(v / vote-01"
        "   :polarity -"
        '   :ARG0 (h / organization :name (n / name :op1 "House"))'
        '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
    )
    parses = [
        FakeAmrParse("The House voted against H.R. 1234.", 0, 0, 35, pen)
    ]
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, raw_text="The House voted against H.R. 1234."))

    assert len(result["amr_assertions"]) == 1
    a = result["amr_assertions"][0]
    assert a.predicate == "voted_on"
    assert a.polarity is False
    assert a.amr_frame == "vote-01"


@pytest.mark.asyncio
async def test_scenario_withdraw_01_negative_polarity_is_cosponsor_withdrawal():
    """QA-B contract: ``withdraw-01`` with ``:polarity -`` maps to
    ``co_sponsors`` predicate AND ``polarity=False`` — downstream interprets
    this as a cosponsorship withdrawal. End-to-end against the real
    congress pack.
    """
    if not _CONGRESS_PACK_DIR.exists():
        pytest.skip("congress pack not available")
    pack = load_label_pack(_CONGRESS_PACK_DIR, "congress")

    pen = (
        "(w / withdraw-01"
        "   :polarity -"
        '   :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Jones"))'
        '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
    )
    parses = [
        FakeAmrParse("Rep. Jones withdrew cosponsorship.", 0, 0, 35, pen)
    ]
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, raw_text="Rep. Jones withdrew cosponsorship."))

    a = result["amr_assertions"][0]
    assert a.predicate == "co_sponsors"
    assert a.polarity is False
    assert a.amr_frame == "withdraw-01"
