"""QA-2 pyramid for Step 2 (Dev-2 / Wave-1 contracts-core landing).

This file is the QA-2 split — separate from the dev's ``test_amr_project.py``
and QA-1's ``test_amr_project_qa.py``. It hammers the surfaces that landed
in this step:

  * ``AmrToAssertionNode`` now emits ``catalyst_contracts_core.Assertion``
    directly (instead of the deleted ``AmrAssertion``).
  * ``ExtractionResource._run_amr_pipeline`` / ``_run_ner_only_pipeline``
    no longer route through ``dagster_io.models``.
  * ``ExtractionMethod`` has new ``AMR_PROJECTION`` and ``NER_ENSEMBLE``
    enum values — both paths must stamp the right one.
  * Wave-1 Assertion/Mention/Provenance are ``frozen=True, extra="forbid"``
    with polarity↔negated auto-sync — verify nothing slips past.

Tier counts (target ~25 tests):
  T1 adversarial unit : 15
  T2 property-based   :  5
  T3 differential     :  3
  T4 scenario         :  2
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import penman
import pytest
from catalyst_contracts_core import (
    Assertion,
    ExtractionMethod,
    Mention,
    Provenance,
)
from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
from catalyst_langgraph.label_packs.loader import AmrFrames, LabelPack
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError


# Override conftest's autouse event_store fixture — projection has its own
# no-op fallback.
@pytest.fixture(autouse=True)
def configure_event_store():  # noqa: D401 — fixture override
    """No-op replacement for the dagster_io-backed conftest fixture."""
    yield


# ---------------------------------------------------------------------------
# Lightweight AmrSentenceParse stand-in
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
    doc_id: str = "doc-qa2",
    chunk_id: str | None = None,
    source_metadata: dict | None = None,
) -> dict:
    src_meta = source_metadata if source_metadata is not None else {
        "document_id": doc_id,
        "chunk_id": chunk_id or "chunk-qa2",
    }
    state = {
        "raw_text": raw_text,
        "doc_id": doc_id,
        "source_metadata": src_meta,
        "amr_parses": parses,
        "consensus_mentions": consensus_mentions or [],
        "stages": {},
        "audit_events": [],
        "status": "pending",
    }
    if chunk_id is not None:
        state["chunk_id"] = chunk_id
    return state


# Common reusable PENMAN.
_INTRO_PEN = (
    "(i / introduce-01"
    '   :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Smith"))'
    '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
)

_NEG_REPORT = (
    "(r / report-01"
    "   :polarity -"
    '   :ARG0 (c / committee :name (n / name :op1 "Energy"))'
    '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
)


# ===========================================================================
# Tier 1 — Adversarial unit tests
# ===========================================================================


# ---- T1-01: AMR projection stamps the NEW AMR_PROJECTION enum value -------


@pytest.mark.asyncio
async def test_extraction_method_amr_projection_is_stamped_on_assertion_provenance():
    """Contract pin (Wave-1): the projection node must stamp
    ``ExtractionMethod.AMR_PROJECTION`` (not ``STRUCTURED``) on every
    emitted Assertion's Provenance.

    QA-2 hand-off note: this test would have failed against Dev-2's
    original code which used ``STRUCTURED``; the fix is to use the
    AMR_PROJECTION value added to the enum in Wave-1.
    """
    parses = [FakeAmrParse("Rep. Smith introduced H.R. 1234.", 0, 0, 32, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    assertions = result["amr_assertions"]
    assert assertions
    for a in assertions:
        assert a.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION, (
            f"expected AMR_PROJECTION, got {a.provenance.extraction_method!r}"
        )
        # And the extraction_model still carries the pack id for lineage.
        assert "amr_projection+" in a.provenance.extraction_model
        assert a.provenance.extraction_model.endswith("test-pack")


# ---- T1-02: NER half stamps NER_ENSEMBLE ----------------------------------


def test_resource_ner_path_uses_ner_ensemble_extraction_method():
    """Contract pin (Wave-1): the NER mention adapter in
    ``ExtractionResource._run_amr_pipeline`` and ``_run_ner_only_pipeline``
    must use ``ExtractionMethod.NER_ENSEMBLE`` (not ``STRUCTURED``).

    We pin this by reading the resource source — instantiating
    ``ExtractionResource`` requires the optional ``dagster`` dep that
    isn't installed in the unit-test sandbox. Source-level pin still
    catches the drift the QA contract is guarding.
    """
    src_path = Path(__file__).parent.parent / "src" / "catalyst_exgraph" / "resource.py"
    src = src_path.read_text()

    # Both NER adapter loops must reference NER_ENSEMBLE.
    n_ner_ensemble = len(re.findall(r"ExtractionMethod\.NER_ENSEMBLE", src))
    assert n_ner_ensemble >= 2, (
        f"NER mention adapters should use ExtractionMethod.NER_ENSEMBLE in both "
        f"_run_amr_pipeline and _run_ner_only_pipeline (found {n_ner_ensemble} refs)"
    )

    # And neither NER adapter should still be on STRUCTURED — the only
    # remaining STRUCTURED ref (if any) would be in unrelated code paths.
    # We assert nothing inside the Mention(...) constructions uses STRUCTURED.
    # Easiest: find every Mention(...) block; verify it uses NER_ENSEMBLE.
    for match in re.finditer(
        r"Mention\(\s*(?:[^()]|\([^()]*\))*?\)",
        src,
        flags=re.DOTALL,
    ):
        block = match.group(0)
        if "extraction_method=" in block:
            assert "ExtractionMethod.NER_ENSEMBLE" in block, (
                f"Mention construction still uses non-NER_ENSEMBLE method:\n{block}"
            )
            assert "ExtractionMethod.STRUCTURED" not in block, (
                f"Mention construction still uses STRUCTURED:\n{block}"
            )


# ---- T1-03: empty source_metadata still produces valid Provenance --------


@pytest.mark.asyncio
async def test_empty_source_metadata_does_not_crash_and_yields_valid_provenance():
    """Pin: when ``source_metadata`` is empty AND ``doc_id`` is empty,
    the projection node falls back to empty/sentinel strings on Provenance
    fields rather than crashing. Provenance is required (no default) in
    Wave-1.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)

    # Bypass _state helper — build the state manually with everything
    # empty so we exercise the falsy-fallback paths inside the node.
    state = {
        "raw_text": "",
        "doc_id": "",
        "source_metadata": {},
        "amr_parses": parses,
        "consensus_mentions": [],
        "stages": {},
        "audit_events": [],
        "status": "pending",
    }
    result = await node(state)

    a = result["amr_assertions"][0]
    # Provenance is required — validation would fail at construction if any
    # required field were None. Reaching here means it constructed cleanly.
    assert isinstance(a.provenance, Provenance)
    assert a.provenance.source_document_id == ""
    # chunk_id falls back to "<doc_id>:_amr" via the projection node when
    # nothing is provided. The contract is "non-None, non-crash"; the
    # exact fallback string is implementation detail — pin loosely.
    assert isinstance(a.provenance.chunk_id, str)
    assert a.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION


# ---- T1-04: assertion_id collision — qualifiers NOT in the hash ----------


@pytest.mark.asyncio
async def test_assertion_id_collides_when_only_qualifiers_differ():
    """Behavior pin (dev-flagged tradeoff #3): ``assertion_id`` is hashed
    over ``(subject_text, predicate, object_text, chunk_id, sentence_index)``
    — qualifiers are NOT in the hash. Two AMR predicate frames that share
    SPO + same chunk + same sentence_index but differ only in qualifiers
    WILL collide.

    Current decision: accept the collision (rare in practice — two
    distinct predicate frames in the same sentence with identical SPO and
    different time/location are uncommon). Concordance mints longer
    canonical ids post-resolution. If a future refactor extends the hash
    to include qualifiers, this test breaks loudly and the trade-off can
    be revisited.
    """
    p1 = (
        "(s / say-01"
        '   :ARG0 (p / person :name (n / name :op1 "A"))'
        '   :ARG1 (c / claim)'
        "   :time (t / today))"
    )
    p2 = (
        "(s / say-01"
        '   :ARG0 (p / person :name (n / name :op1 "A"))'
        '   :ARG1 (c / claim)'
        "   :time (t / tomorrow))"
    )
    parses = [
        # Same sentence_index (0) and same chunk → collision territory.
        FakeAmrParse("s1", 0, 0, 20, p1),
        FakeAmrParse("s2", 0, 0, 20, p2),
    ]
    pack = _pack(frames={"say-01": "states"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses, chunk_id="chunk-collide"))

    ids = [a.assertion_id for a in result["amr_assertions"]]
    assert len(ids) == 2
    assert ids[0] == ids[1], (
        "assertion_id collision pin: expected current behavior to collide. "
        "If you extended the hash to include qualifiers, this test should be "
        "updated and the qualifiers-in-hash decision documented."
    )
    # And their qualifiers are demonstrably different — proof the
    # collision is meaningful, not a fixture quirk.
    quals = [a.qualifiers for a in result["amr_assertions"]]
    assert quals[0] != quals[1]


# ---- T1-05: assertion_id is deterministic across identical runs ----------


@pytest.mark.asyncio
async def test_assertion_id_is_deterministic_across_runs():
    """Pin: the md5-based assertion_id is fully determined by
    (subject, predicate, object, chunk_id, sentence_index). Same PENMAN
    twice → identical assertion_ids. Required for dedup downstream.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    r1 = await node(_state(parses, chunk_id="c-fixed"))
    r2 = await node(_state(parses, chunk_id="c-fixed"))
    assert r1["amr_assertions"][0].assertion_id == r2["amr_assertions"][0].assertion_id


# ---- T1-06: Assertion is frozen — top-level field mutation rejected ------


@pytest.mark.asyncio
async def test_assertion_top_level_mutation_rejected_after_emit():
    """Pin (Wave-1 contract): Assertion is ``frozen=True`` — once the
    projection emits it, callers cannot reassign top-level fields. Any
    downstream code mutating ``a.subject_text``/``a.predicate``/``a.polarity``
    is buggy.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))
    a = result["amr_assertions"][0]

    with pytest.raises(ValidationError):
        a.subject_text = "mutated"  # type: ignore[misc]
    with pytest.raises(ValidationError):
        a.predicate = "other"  # type: ignore[misc]
    with pytest.raises(ValidationError):
        a.polarity = False  # type: ignore[misc]


# ---- T1-07: qualifiers dict is mutable by reference — footgun pin --------


@pytest.mark.asyncio
async def test_assertion_qualifiers_dict_is_mutable_by_reference_footgun_pin():
    """Footgun pin: even though Assertion is ``frozen=True``, the
    ``qualifiers`` field is a ``dict[str, str]`` — pydantic's frozen
    flag prevents REBINDING the attribute, not mutation of the bound
    object. ``a.qualifiers["new_key"] = "x"`` succeeds.

    This is a sharp edge — emit code should never hand out shared
    qualifier references. Pin so a future fix (e.g. switch to a tuple-
    of-pairs / immutabledict, or defensive copy in __init__) is visible.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))
    a = result["amr_assertions"][0]

    initial_qualifiers = dict(a.qualifiers)
    a.qualifiers["sneaky_mutation"] = "yes"
    # The mutation succeeds because dicts aren't deep-frozen.
    assert a.qualifiers != initial_qualifiers
    assert a.qualifiers.get("sneaky_mutation") == "yes"
    # This is the documented footgun: callers MUST not rely on
    # qualifier-dict identity across pipeline boundaries.


# ---- T1-08: polarity → negated sync via Wave-1 validator -----------------


@pytest.mark.asyncio
async def test_polarity_false_auto_syncs_negated_true_via_validator():
    """Wave-1 contract: ``model_validator(mode='after')`` auto-syncs
    ``negated := not polarity`` on every Assertion. Confirm the AMR
    projection's negative-polarity emit gets that sync.
    """
    parses = [FakeAmrParse("x", 0, 0, 40, _NEG_REPORT)]
    pack = _pack(frames={"report-01": "reported_out"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    a = result["amr_assertions"][0]
    assert a.polarity is False
    assert a.negated is True


# ---- T1-09: polarity sync survives JSON round-trip -----------------------


@pytest.mark.asyncio
async def test_negated_polarity_survives_json_round_trip():
    """JSON round-trip on a negative-polarity assertion must preserve
    ``polarity=False, negated=True``. Catches any serialization that
    forgets to emit one of the two fields.
    """
    parses = [FakeAmrParse("x", 0, 0, 40, _NEG_REPORT)]
    pack = _pack(frames={"report-01": "reported_out"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    a = result["amr_assertions"][0]
    blob = a.model_dump_json()
    a2 = Assertion.model_validate_json(blob)
    assert a2.polarity is False
    assert a2.negated is True
    assert a2.predicate == a.predicate


# ---- T1-10: custom role_override on say-01 ARG2 — dropped mention-link ---


@pytest.mark.asyncio
async def test_custom_role_override_drops_mention_link_for_adjunct_position():
    """Dev-2 flagged contract gap: ``canonical_entity_refs`` was dropped
    in favour of scalar ``subject_mention_id`` / ``object_mention_id``.
    Custom role_overrides (e.g. ARG2 → ``source_attribution``) ONLY land
    as text in ``qualifiers`` — there is no entity-link slot for them.

    Pin this so the contract gap is visible: a matching consensus
    mention for the source_attribution speaker EXISTS in the input but
    its mention_id is dropped on the floor. Closing the gap means
    introducing a ``qualifier_mention_ids`` field on the contracts-core
    Assertion model (out of scope for this step).
    """
    pen = (
        "(s / say-01"
        '   :ARG0 (p / person :name (n / name :op1 "Speaker"))'
        '   :ARG1 (c / claim)'
        '   :ARG2 (a / authority :name (n3 / name :op1 "Reuters")))'
    )
    pack = _pack(
        frames={"say-01": "states"},
        role_overrides={
            "say-01": {
                "ARG0": "subject",
                "ARG1": "object",
                "ARG2": "source_attribution",
            }
        },
    )
    mentions = [
        {"mention_id": "m-reuters", "text": "Reuters", "span_start": 0, "span_end": 80},
        {"mention_id": "m-speaker", "text": "Speaker", "span_start": 0, "span_end": 80},
    ]
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state([FakeAmrParse("s", 0, 0, 80, pen)], consensus_mentions=mentions)
    )

    a = result["amr_assertions"][0]
    # The source attribution is text-only in qualifiers.
    assert a.qualifiers.get("source_attribution") == "Reuters"
    # Subject/object mention ids resolve normally.
    assert a.subject_mention_id == "m-speaker"
    # ``object`` here is "claim" (no matching consensus mention) — so None.
    assert a.object_mention_id is None
    # And the proof of the dropped-info contract: m-reuters EXISTS in
    # the consensus list, matches by text, falls inside the sentence
    # span — but there is no field on Assertion that carries it.
    asserted_mention_ids = {a.subject_mention_id, a.object_mention_id}
    assert "m-reuters" not in asserted_mention_ids


# ---- T1-11: subject substring-matches multiple mentions — first wins -----


@pytest.mark.asyncio
async def test_substring_match_multiple_mentions_first_in_list_wins():
    """Adversarial: bare ``"Smith"`` surface substring-matches both
    ``"Rep. Smith"`` and ``"Sen. Smith"`` consensus mentions. The
    matcher is documented as substring + case-insensitive + first-in-
    list-iteration — pin the deterministic-policy contract.
    """
    pen = (
        "(i / introduce-01"
        '   :ARG0 (p / person :name (n / name :op1 "Smith"))'
        "   :ARG1 (b / bill))"
    )
    mentions = [
        {"mention_id": "ent-rep", "text": "Rep. Smith", "span_start": 0, "span_end": 50},
        {"mention_id": "ent-sen", "text": "Sen. Smith", "span_start": 0, "span_end": 50},
    ]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state([FakeAmrParse("s", 0, 0, 50, pen)], consensus_mentions=mentions)
    )

    a = result["amr_assertions"][0]
    assert a.subject_mention_id == "ent-rep"  # first in list wins


# ---- T1-12: predicate frame with no ARGn edges still emits ---------------


@pytest.mark.asyncio
async def test_frame_with_no_argn_edges_emits_assertion_with_empty_subject():
    """A predicate frame with no ARGn edges (rare in real PropBank but
    possible) — projection emits an Assertion with ``subject_text=""``
    and ``object_text=None``. The assertion is NOT dropped just because
    args are missing.
    """
    pen = "(p / pass-03)"  # truly bare frame
    pack = _pack(frames={"pass-03": "passed"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 10, pen)]))

    assert len(result["amr_assertions"]) == 1
    a = result["amr_assertions"][0]
    assert a.subject_text == ""
    assert a.object_text is None
    assert a.amr_role_mapping == {}
    assert a.predicate == "passed"


# ---- T1-13: is_novel_predicate is False for any frame in the table -------


@pytest.mark.asyncio
async def test_extended_predicate_via_frames_table_is_not_marked_novel():
    """An ``extended_predicates`` membership doesn't directly affect
    is_novel_predicate (the projection only checks ``frames`` for known
    mappings). Pin that putting a frame in ``frames`` with a canonical
    value makes it non-novel; an ``extended_predicates`` entry without
    a ``frames`` mapping is treated as unknown.
    """
    # voted_on is a canonical predicate that IS in extended_predicates
    # for the congress pack. With a frames mapping, it's a known frame.
    pen = (
        "(v / vote-01"
        '   :ARG0 (p / person :name (n / name :op1 "X"))'
        "   :ARG1 (b / bill))"
    )
    pack = _pack(
        frames={"vote-01": "voted_on"},
        extended_predicates=frozenset({"voted_on"}),
    )
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 30, pen)]))

    a = result["amr_assertions"][0]
    assert a.is_novel_predicate is False
    assert a.confidence == 1.0


# ---- T1-14: extra-field rejection at the Assertion model level -----------


def test_assertion_rejects_extra_fields_per_wave1_contract():
    """Wave-1 contract: ``extra="forbid"`` on Assertion. Any future
    pipeline that adds a stray field MUST update the model first; the
    extra-field path cannot pass silently.
    """
    valid = {
        "assertion_id": "x",
        "subject_text": "s",
        "predicate": "p",
        "amr_frame": "f-01",
        "amr_variable": "v",
        "sentence_index": 0,
        "sentence_char_start": 0,
        "sentence_char_end": 1,
        "provenance": {
            "source_document_id": "",
            "chunk_id": "",
            "extraction_method": "amr_projection",
        },
    }
    # Sanity: clean payload validates.
    Assertion.model_validate(valid)
    # Stray field rejected.
    polluted = {**valid, "future_field": "bad"}
    with pytest.raises(ValidationError):
        Assertion.model_validate(polluted)


# ---- T1-15: predicate min_length=1 rejects empty string ------------------


def test_assertion_predicate_min_length_rejects_empty_string():
    """Pin: ``predicate`` has ``min_length=1``; empty string is rejected.
    The projection node has a guard (``mapped is not None and mapped.strip()``)
    that prevents emitting empty predicates — but if a future refactor
    bypasses that guard, the model-level validator catches it.
    """
    bad = {
        "assertion_id": "x",
        "subject_text": "s",
        "predicate": "",  # empty
        "amr_frame": "f-01",
        "amr_variable": "v",
        "sentence_index": 0,
        "sentence_char_start": 0,
        "sentence_char_end": 1,
        "provenance": {"source_document_id": "", "chunk_id": ""},
    }
    with pytest.raises(ValidationError):
        Assertion.model_validate(bad)


# ===========================================================================
# Tier 2 — Property-based tests (hypothesis)
# ===========================================================================


_FRAMES = st.sampled_from(
    ["introduce-01", "report-01", "vote-01", "pass-03", "refer-01"]
)


@st.composite
def _simple_penman(draw):
    """Generate a simple (frame, subject_name, object_name, PENMAN) tuple."""
    frame = draw(_FRAMES)
    subj = draw(st.sampled_from(["Smith", "Jones", "Brown"]))
    obj = draw(st.sampled_from(["HR1", "HR2", "S100"]))
    pen = (
        f"(p / {frame}"
        f'   :ARG0 (a / person :name (n / name :op1 "{subj}"))'
        f'   :ARG1 (b / bill :name (n2 / name :op1 "{obj}")))'
    )
    return frame, subj, obj, pen


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fixture=_simple_penman())
@pytest.mark.asyncio
async def test_property_predicate_count_matches_frame_count(fixture):
    """Invariant: for any PENMAN with N predicate frames (and
    ``unknown_frame_action != "drop"``), the projection emits exactly N
    assertions.
    """
    frame, _subj, _obj, pen = fixture
    pack = _pack(frames={frame: "did"})
    node = AmrToAssertionNode(label_pack=pack)
    parses = [FakeAmrParse("s", 0, 0, 50, pen)]
    result = await node(_state(parses))
    n_predicates_in_penman = sum(
        1
        for inst in penman.decode(pen).instances()
        if re.match(r"^[a-z][a-z-]*-\d+$", inst.target)
    )
    assert len(result["amr_assertions"]) == n_predicates_in_penman


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fixture=_simple_penman())
@pytest.mark.asyncio
async def test_property_polarity_negated_invariant_holds(fixture):
    """Invariant: every emitted Assertion has ``negated == not polarity``
    after the contracts-core validator runs.
    """
    frame, _subj, _obj, pen = fixture
    pack = _pack(frames={frame: "did"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 50, pen)]))

    for a in result["amr_assertions"]:
        assert a.polarity in (True, False)
        assert a.negated == (not a.polarity)


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fixture=_simple_penman())
@pytest.mark.asyncio
async def test_property_subject_nonempty_when_arg0_present(fixture):
    """Invariant: for PENMAN that DOES have ARG0 (the strategy guarantees
    one), every emitted Assertion has ``subject_text != ""``.
    """
    frame, subj, _obj, pen = fixture
    pack = _pack(frames={frame: "did"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 50, pen)]))

    for a in result["amr_assertions"]:
        assert a.subject_text != "", f"empty subject_text for PENMAN with ARG0: {pen}"
        assert subj in a.subject_text


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fixture=_simple_penman())
@pytest.mark.asyncio
async def test_property_determinism_modulo_timestamp(fixture):
    """Invariant: same (penman, label_pack, consensus_mentions) → identical
    ``model_dump()`` after scrubbing ``provenance.timestamp`` (wall-clock).
    """
    frame, _subj, _obj, pen = fixture
    parses = [FakeAmrParse("s", 0, 0, 50, pen)]
    pack = _pack(frames={frame: "did"})
    node = AmrToAssertionNode(label_pack=pack)
    r1 = await node(_state(parses, chunk_id="c1"))
    r2 = await node(_state(parses, chunk_id="c1"))

    def _scrub(rs):
        out = []
        for a in rs["amr_assertions"]:
            d = a.model_dump()
            if d.get("provenance"):
                d["provenance"].pop("timestamp", None)
            out.append(d)
        return out

    assert _scrub(r1) == _scrub(r2)


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fixture=_simple_penman())
@pytest.mark.asyncio
async def test_property_provenance_extraction_method_always_amr_projection(fixture):
    """Invariant: every Assertion emitted by the projection node has
    ``provenance.extraction_method == ExtractionMethod.AMR_PROJECTION``.
    Catches regressions where the enum value drifts back to STRUCTURED.
    """
    frame, _subj, _obj, pen = fixture
    pack = _pack(frames={frame: "did"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state([FakeAmrParse("s", 0, 0, 50, pen)]))

    for a in result["amr_assertions"]:
        assert a.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION


# ===========================================================================
# Tier 3 — Differential tests
# ===========================================================================


@pytest.mark.asyncio
async def test_differential_two_runs_assertion_id_stability():
    """Differential: same PENMAN run via two independent
    ``AmrToAssertionNode`` instances yields identical assertion_ids.
    No hidden mutable state on the node.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})

    node1 = AmrToAssertionNode(label_pack=pack)
    node2 = AmrToAssertionNode(label_pack=pack)

    r1 = await node1(_state(parses, chunk_id="cdiff"))
    r2 = await node2(_state(parses, chunk_id="cdiff"))

    ids1 = [a.assertion_id for a in r1["amr_assertions"]]
    ids2 = [a.assertion_id for a in r2["amr_assertions"]]
    assert ids1 == ids2


@pytest.mark.asyncio
async def test_differential_pack_name_propagates_to_extraction_model():
    """Differential: ``label_pack.name`` is mirrored into
    ``provenance.extraction_model`` as ``amr_projection+<pack_name>``.
    Two packs with different names → different extraction_model strings.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack_a = LabelPack(
        name="pack-A",
        amr_frames=AmrFrames(frames={"introduce-01": "introduces"}),
    )
    pack_b = LabelPack(
        name="pack-B",
        amr_frames=AmrFrames(frames={"introduce-01": "introduces"}),
    )

    r_a = await AmrToAssertionNode(label_pack=pack_a)(_state(parses))
    r_b = await AmrToAssertionNode(label_pack=pack_b)(_state(parses))

    a_a = r_a["amr_assertions"][0]
    a_b = r_b["amr_assertions"][0]
    assert a_a.provenance.extraction_model == "amr_projection+pack-A"
    assert a_b.provenance.extraction_model == "amr_projection+pack-B"
    # And the canonical predicate is identical — only the lineage tag differs.
    assert a_a.predicate == a_b.predicate


def test_differential_mvp_demo_emits_three_assertions_with_correct_polarity():
    """MVP demo regression: subprocess-run the ``examples/amr_congress_mvp.py``
    and pin the user-visible output shape.

    Expected: 3 assertions, predicates ``[introduces, refers_to,
    reported_by]``, polarity pattern ``[True, True, False]`` (the
    negated ``report-01`` is the third).
    """
    demo = (
        Path(__file__).parent.parent / "examples" / "amr_congress_mvp.py"
    )
    if not demo.is_file():
        pytest.skip(f"MVP demo missing at {demo}")
    # Check the congress pack is available; skip if not (the demo path
    # has been relocated historically).
    congress = Path(
        "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
        "k8s/base/congress-data/prompts/congress.labels.yaml"
    )
    if not congress.is_file():
        pytest.skip("congress pack not present at expected location")

    result = subprocess.run(
        [sys.executable, str(demo)],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"MVP demo crashed:\nstdout=\n{result.stdout}\nstderr=\n{result.stderr}"
    )
    out = result.stdout

    # Pin "total assertions: 3".
    m = re.search(r"total assertions:\s*(\d+)", out)
    assert m is not None, f"could not find 'total assertions' in:\n{out}"
    assert m.group(1) == "3", f"expected 3 assertions, got {m.group(1)}"

    # Pin "negated: 1" — exactly one negated assertion.
    m = re.search(r"negated:\s*(\d+)", out)
    assert m is not None
    assert m.group(1) == "1"

    # Pin predicate order in the output: introduces → refers_to → reported_by.
    intro_pos = out.find("--introduces+")
    refers_pos = out.find("--refers_to+")
    reported_pos = out.find("--reported_by")
    assert intro_pos != -1, "introduces predicate missing from demo output"
    assert refers_pos != -1, "refers_to predicate missing from demo output"
    assert reported_pos != -1, "reported_by predicate missing from demo output"
    # Order: intro before refers, refers before reported.
    assert intro_pos < refers_pos < reported_pos


# ===========================================================================
# Tier 4 — Scenario tests
# ===========================================================================


_CONGRESS_PACK_NEW = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/base/congress-data/prompts"
)


@pytest.mark.asyncio
async def test_scenario_real_congress_pack_two_sentence_chunk_end_to_end():
    """Real-shape end-to-end: load the actual congress pack, two-sentence
    chunk with hand-written PENMAN, NER consensus list with subject + bill
    + committee mentions. Verify:
      * Each assertion's provenance carries ``AMR_PROJECTION``.
      * subject_mention_id / object_mention_id propagate.
      * Frozen Assertion behavior holds (top-level mutation rejected).
      * JSON round-trip survives.
    """
    if not _CONGRESS_PACK_NEW.is_dir():
        pytest.skip(f"congress pack missing at {_CONGRESS_PACK_NEW}")
    from catalyst_langgraph.label_packs import load_label_pack

    pack = load_label_pack(_CONGRESS_PACK_NEW, "congress")

    # "Smith introduced H.R. 1234. It was referred to Energy and Commerce."
    pen_s0 = (
        "(i / introduce-01"
        '   :ARG0 (p / person :name (n / name :op1 "Smith"))'
        '   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")))'
    )
    pen_s1 = (
        "(r / refer-01"
        "   :ARG1 (b / bill)"
        '   :ARG2 (c / committee :name (n / name :op1 "Energy" :op2 "and" :op3 "Commerce")))'
    )
    parses = [
        FakeAmrParse("Smith introduced H.R. 1234.", 0, 0, 27, pen_s0),
        FakeAmrParse(
            "It was referred to Energy and Commerce.", 1, 28, 67, pen_s1
        ),
    ]
    mentions = [
        {"mention_id": "m-smith", "text": "Smith", "span_start": 0, "span_end": 5},
        {"mention_id": "m-bill", "text": "H.R. 1234", "span_start": 17, "span_end": 26},
        {
            "mention_id": "m-committee",
            "text": "Energy and Commerce",
            "span_start": 47,
            "span_end": 66,
        },
    ]
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(
        _state(parses, consensus_mentions=mentions, doc_id="d-real", chunk_id="c-real")
    )

    assertions = result["amr_assertions"]
    by_frame = {a.amr_frame: a for a in assertions}
    assert "introduce-01" in by_frame
    assert "refer-01" in by_frame

    intro = by_frame["introduce-01"]
    refer = by_frame["refer-01"]

    # Each carries AMR_PROJECTION extraction_method.
    assert intro.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION
    assert refer.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION

    # Smith → subject_mention_id on intro.
    assert intro.subject_mention_id == "m-smith"
    # Bill → object_mention_id on intro.
    assert intro.object_mention_id == "m-bill"

    # refer-01 in congress pack: ARG1=subject, ARG2=object.
    # In sentence 1 the bill var ``b`` has no :name so the subject_text
    # resolves to literal "bill" — bills mention is in sentence 0's span,
    # so the matcher filters it out. We just check the committee object.
    assert refer.object_mention_id == "m-committee"

    # Frozen — top-level mutation rejected.
    with pytest.raises(ValidationError):
        intro.subject_text = "ALTERED"  # type: ignore[misc]

    # JSON round-trip survives.
    blob = intro.model_dump_json()
    intro2 = Assertion.model_validate_json(blob)
    assert intro2.predicate == intro.predicate
    assert intro2.subject_mention_id == intro.subject_mention_id
    assert intro2.provenance.extraction_method == ExtractionMethod.AMR_PROJECTION


@pytest.mark.asyncio
async def test_scenario_code_location_caller_stamp_path():
    """Scenario: the projection node leaves ``code_location=""`` so the
    caller (resource layer) can stamp it post-emit. Provenance is NOT
    frozen, so the stamp succeeds.

    This pins the cooperative-contract between projection (writes "") and
    resource (mutates after emit). If a future refactor makes Provenance
    frozen, this test breaks and the resource needs to switch to
    model_copy/replace.
    """
    parses = [FakeAmrParse("x", 0, 0, 30, _INTRO_PEN)]
    pack = _pack(frames={"introduce-01": "introduces"})
    node = AmrToAssertionNode(label_pack=pack)
    result = await node(_state(parses))

    a = result["amr_assertions"][0]
    # Projection leaves it empty.
    assert a.provenance.code_location == ""

    # Caller (resource) can stamp post-emit.
    a.provenance.code_location = "congress_data"
    assert a.provenance.code_location == "congress_data"

    # And the assertion itself is still otherwise frozen — only the
    # nested Provenance is mutable, not the Assertion top-level.
    with pytest.raises(ValidationError):
        a.predicate = "other"  # type: ignore[misc]
