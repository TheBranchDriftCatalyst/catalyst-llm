"""QA pyramid tests for the unified Mention + Assertion wire shapes.

Companion to ``tests/test_unified_models.py`` (the dev's pyramid). This file
holds the QA-half coverage: adversarial gaps the dev's tests don't pin,
property-based round-trips that stress fields the dev didn't generate,
differential checks against the package re-exports, and one new scenario
test built from the AMR MVP demo's three-assertion shape.

Tiers:
  T1 — Adversarial unit (60% of new coverage)
  T2 — Property-based (hypothesis, 25%)
  T3 — Differential / cross-package (10%)
  T4 — Scenario (5%)

Bugs surfaced in these tests are fixed in ``types.py``, not papered over here.
"""

from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

import catalyst_contracts_core as pkg
from catalyst_contracts_core import types as pkg_types
from catalyst_contracts_core.enums import ExtractionMethod, MentionType
from catalyst_contracts_core.types import Assertion, Mention, Provenance


# ─────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────


def _prov(**overrides) -> Provenance:
    """Minimal valid Provenance for use as a test fixture."""
    defaults = {"source_document_id": "doc-qa", "chunk_id": "chunk-qa"}
    defaults.update(overrides)
    return Provenance(**defaults)


def _mention(**overrides) -> Mention:
    """Minimal valid Mention. Overrides win."""
    defaults = {
        "mention_id": "m-qa",
        "text": "sample",
        "canonical_type": "PERSON",
        "span_start": 0,
        "span_end": 6,
        "provenance": _prov(),
    }
    defaults.update(overrides)
    return Mention(**defaults)


def _assertion(**overrides) -> Assertion:
    """Minimal valid Assertion. Overrides win."""
    defaults = {
        "assertion_id": "a-qa",
        "subject_text": "subj",
        "predicate": "rel",
        "object_text": "obj",
        "provenance": _prov(),
    }
    defaults.update(overrides)
    return Assertion(**defaults)


# ═════════════════════════════════════════════════════════════════════════
# Tier 1 — Adversarial unit (~15 tests)
# ═════════════════════════════════════════════════════════════════════════


class TestMentionAdversarialQA:
    """Edge cases in Mention construction that the dev's tests don't pin."""

    def test_span_end_less_than_span_start_rejected(self):
        """A negative-width span is a garbage extraction. The validator in
        ``types.py`` rejects ``span_end < span_start``."""
        with pytest.raises(ValidationError) as ei:
            _mention(span_start=10, span_end=5)
        # Make the error message useful — pin that it cites the bad fields
        assert "span_end" in str(ei.value)

    def test_span_end_equal_to_span_start_allowed(self):
        """Zero-width spans are legal (some tokenizers emit them for
        punctuation / boundary markers). Just pin current permissive behavior."""
        m = _mention(span_start=5, span_end=5)
        assert m.span_start == m.span_end == 5

    def test_empty_canonical_type_rejected(self):
        """``canonical_type`` is the type label; empty string is meaningless.
        ``min_length=1`` constraint enforces non-empty."""
        with pytest.raises(ValidationError):
            _mention(canonical_type="")

    def test_n_encoders_zero_rejected(self):
        """A mention came from at least one encoder. ``ge=1`` constraint
        keeps the field semantically meaningful."""
        with pytest.raises(ValidationError):
            _mention(n_encoders=0)

    def test_vote_count_zero_allowed_currently(self):
        """``vote_count`` has no lower bound — pin current behavior.
        Consensus code may legitimately emit a mention with zero votes if
        it carries an explicit reject-then-keep override; the model
        layer doesn't enforce."""
        m = _mention(vote_count=0)
        assert m.vote_count == 0

    def test_extra_fields_forbidden(self):
        """``extra="forbid"`` on Mention — unknown kwargs are a contract leak
        (typo'd field name silently dropped to a None default). Reject loudly."""
        with pytest.raises(ValidationError) as ei:
            _mention(foo="bar")
        assert "foo" in str(ei.value).lower() or "extra" in str(ei.value).lower()

    def test_mention_is_frozen(self):
        """Mentions are wire shapes — once constructed they must not mutate.
        ``frozen=True`` on the model config enforces immutability so downstream
        graph nodes can rely on stable hashes."""
        m = _mention()
        with pytest.raises(ValidationError):
            m.text = "mutated"  # type: ignore[misc]

    def test_provenance_required_no_default_at_field(self):
        """Re-pin the dev's provenance-required test with a finer assertion:
        the error message must name the ``provenance`` field so callers can
        debug a missing-kwarg crash."""
        with pytest.raises(ValidationError) as ei:
            Mention(
                mention_id="m",
                text="t",
                canonical_type="PERSON",
                span_start=0,
                span_end=1,
            )  # type: ignore[call-arg]
        assert "provenance" in str(ei.value).lower()

    def test_source_models_can_exceed_vote_count(self):
        """Pin permissive behavior: ``source_models`` can be longer than
        ``vote_count`` (e.g. encoders that *attempted* extraction even if
        their vote was rejected later). The model layer does not enforce
        this invariant; consensus code does."""
        m = _mention(vote_count=1, source_models=["a", "b", "c"])
        assert len(m.source_models) == 3
        assert m.vote_count == 1


class TestAssertionAdversarialQA:
    """Edge cases in Assertion construction that the dev's tests don't pin."""

    def test_confidence_negative_rejected(self):
        """Mirror of the dev's >1 test — covers the lower boundary."""
        with pytest.raises(ValidationError):
            _assertion(confidence=-0.01)

    def test_empty_predicate_rejected(self):
        """An assertion with no predicate is meaningless. ``min_length=1``
        on ``predicate`` blocks construction."""
        with pytest.raises(ValidationError):
            _assertion(predicate="")

    def test_negated_auto_synced_from_polarity(self):
        """``negated`` is the legacy mirror of ``!polarity`` per the field
        docstring. A post-validator forces the invariant so consumers
        relying on the mirror don't see drift.

        Pass polarity=False alone (default negated=False is wrong); after
        validation negated must be True."""
        a = _assertion(polarity=False)
        assert a.polarity is False
        assert a.negated is True

    def test_negated_auto_synced_even_if_caller_passes_wrong(self):
        """If the caller passes a contradictory (polarity=True, negated=True),
        the post-validator forces the invariant — ``negated := not polarity``.
        Pin this; it's the model's job to keep them aligned."""
        a = _assertion(polarity=True, negated=True)
        assert a.polarity is True
        assert a.negated is False  # forced by validator

    def test_self_referential_subject_object_permitted(self):
        """Pin permissive behavior: ``subject_text == object_text`` is
        legal at the model layer. Self-referential assertions can be
        valid (e.g. 'X is X' tautologies in legal text); higher-level
        QA nodes filter them."""
        a = _assertion(subject_text="same", object_text="same")
        assert a.subject_text == a.object_text

    def test_atemporal_false_with_t_valid_from_allowed(self):
        """The dev pinned (atemporal=True + t_valid_from set) as permissive.
        Pin the inverse — atemporal=False + t_valid_from set is the normal
        case and must work."""
        a = _assertion(is_atemporal=False, t_valid_from="2025-01-01")
        assert a.is_atemporal is False
        assert a.t_valid_from == "2025-01-01"

    def test_amr_role_mapping_empty_role_value_permitted(self):
        """Pin: an empty string value in ``amr_role_mapping`` is allowed.
        Some AMR projections legitimately produce a stub role with no
        resolved surface form pending downstream linking."""
        a = _assertion(amr_role_mapping={"ARG0": ""})
        assert a.amr_role_mapping == {"ARG0": ""}

    def test_extra_fields_forbidden(self):
        """``extra="forbid"`` on Assertion — typo'd fields fail loudly."""
        with pytest.raises(ValidationError):
            _assertion(spurious_field="x")

    def test_assertion_is_frozen(self):
        """Assertions are wire shapes — once constructed they must not
        mutate. ``frozen=True`` enforces this."""
        a = _assertion()
        with pytest.raises(ValidationError):
            a.predicate = "changed"  # type: ignore[misc]

    def test_provenance_required_error_message_names_field(self):
        """Mirror of the Mention test — pin that the missing-provenance
        error message cites the ``provenance`` field by name."""
        with pytest.raises(ValidationError) as ei:
            Assertion(
                assertion_id="a",
                subject_text="s",
                predicate="p",
            )  # type: ignore[call-arg]
        assert "provenance" in str(ei.value).lower()


# ═════════════════════════════════════════════════════════════════════════
# Tier 2 — Property-based (hypothesis, ~6 tests)
# ═════════════════════════════════════════════════════════════════════════


# Strategies — generators that stay within model invariants so we don't
# burn cycles on ValidationErrors we already covered in Tier 1.
_canonical_type_st = st.text(
    min_size=1,
    max_size=32,
    alphabet=st.characters(min_codepoint=33, max_codepoint=126, blacklist_characters="\x00"),
)
_id_st = st.text(min_size=1, max_size=48)
_text_st = st.text(min_size=0, max_size=200)
_pred_st = st.text(min_size=1, max_size=32)


@given(
    mention_id=_id_st,
    text=_text_st,
    canonical_type=_canonical_type_st,
    span_start=st.integers(min_value=0, max_value=100_000),
    span_extent=st.integers(min_value=0, max_value=500),
    vote_count=st.integers(min_value=0, max_value=20),
    n_encoders=st.integers(min_value=1, max_value=20),
    source_models=st.lists(st.text(min_size=1, max_size=16), min_size=0, max_size=10),
    mean_confidence=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    canonical_entity_id=st.one_of(st.none(), st.text(min_size=1, max_size=32)),
)
@settings(suppress_health_check=[HealthCheck.too_slow], max_examples=80)
def test_mention_round_trip_preserves_all_optionals(
    mention_id,
    text,
    canonical_type,
    span_start,
    span_extent,
    vote_count,
    n_encoders,
    source_models,
    mean_confidence,
    canonical_entity_id,
):
    """JSON round-trip preserves every Mention field — including the
    optional ones the dev's hypothesis test doesn't exercise
    (``canonical_entity_id``, full ``source_models`` lists, ``n_encoders``)."""
    m = Mention(
        mention_id=mention_id,
        text=text,
        canonical_type=canonical_type,
        span_start=span_start,
        span_end=span_start + span_extent,
        vote_count=vote_count,
        n_encoders=n_encoders,
        source_models=source_models,
        mean_confidence=mean_confidence,
        canonical_entity_id=canonical_entity_id,
        provenance=_prov(),
    )
    blob = m.model_dump_json()
    restored = Mention.model_validate_json(blob)
    assert restored == m
    # Mention IDs are caller-supplied — must survive verbatim, not be
    # rewritten by any auto-generation.
    assert restored.mention_id == mention_id
    assert restored.canonical_entity_id == canonical_entity_id


@given(
    assertion_id=_id_st,
    subject_text=st.text(min_size=1, max_size=64),
    predicate=_pred_st,
    object_text=st.one_of(st.none(), st.text(min_size=0, max_size=64)),
    amr_frame=st.one_of(st.none(), st.text(min_size=1, max_size=32)),
    amr_role_mapping=st.dictionaries(
        keys=st.sampled_from(["ARG0", "ARG1", "ARG2", "ARG3"]),
        values=st.text(min_size=0, max_size=24),
        max_size=4,
    ),
    polarity=st.booleans(),
    modality=st.one_of(st.none(), st.sampled_from(["possible", "obligation", "permission"])),
    h3_cells=st.lists(st.text(min_size=1, max_size=16), max_size=6),
)
@settings(suppress_health_check=[HealthCheck.too_slow], max_examples=80)
def test_assertion_round_trip_preserves_amr_fields(
    assertion_id,
    subject_text,
    predicate,
    object_text,
    amr_frame,
    amr_role_mapping,
    polarity,
    modality,
    h3_cells,
):
    """JSON round-trip preserves the AMR-specific fields the dev's
    hypothesis test doesn't exercise: ``amr_frame``, ``amr_role_mapping``,
    ``modality``, ``h3_cells``. Also confirms the negated/polarity sync
    invariant survives serialization."""
    a = Assertion(
        assertion_id=assertion_id,
        subject_text=subject_text,
        predicate=predicate,
        object_text=object_text,
        amr_frame=amr_frame,
        amr_role_mapping=amr_role_mapping,
        polarity=polarity,
        modality=modality,
        h3_cells=h3_cells,
        provenance=_prov(),
    )
    blob = a.model_dump_json()
    restored = Assertion.model_validate_json(blob)
    assert restored == a
    # The negated-mirrors-!polarity invariant must hold post round-trip.
    assert restored.negated == (not restored.polarity)
    # Caller-supplied assertion_id survives.
    assert restored.assertion_id == assertion_id


@given(
    polarity=st.booleans(),
    negated_input=st.booleans(),
)
def test_polarity_negated_sync_invariant_holds_for_all_inputs(polarity, negated_input):
    """Property: for every (polarity, negated_input) combination, the
    resulting model satisfies ``negated == not polarity``. The sync
    validator never lets drift through, no matter what the caller passes."""
    a = _assertion(polarity=polarity, negated=negated_input)
    assert a.negated == (not a.polarity)


@given(
    vote_count=st.integers(min_value=1, max_value=10),
    n_models=st.integers(min_value=0, max_value=15),
)
def test_mention_with_vote_count_preserves_source_models_length(vote_count, n_models):
    """Invariant: after JSON round-trip, ``len(source_models)`` is preserved
    exactly. Pydantic must not silently dedup or truncate the list to match
    ``vote_count``."""
    models = [f"encoder-{i}" for i in range(n_models)]
    m = _mention(vote_count=vote_count, source_models=models)
    restored = Mention.model_validate_json(m.model_dump_json())
    assert len(restored.source_models) == n_models
    assert restored.source_models == models


@given(
    is_atemporal=st.booleans(),
    t_from=st.one_of(st.none(), st.sampled_from(["2024-01-01", "2025-06-15"])),
    t_until=st.one_of(st.none(), st.sampled_from(["2026-01-01", "2030-12-31"])),
)
def test_assertion_temporal_fields_round_trip_independently(is_atemporal, t_from, t_until):
    """Property: temporal fields round-trip regardless of the
    is_atemporal/t_valid_from contradiction. The model layer is permissive;
    the dev pinned that explicitly. This property test exhausts the
    combinations to prove no serialization path drops a field silently."""
    a = _assertion(is_atemporal=is_atemporal, t_valid_from=t_from, t_valid_until=t_until)
    restored = Assertion.model_validate_json(a.model_dump_json())
    assert restored.is_atemporal == is_atemporal
    assert restored.t_valid_from == t_from
    assert restored.t_valid_until == t_until


@given(arbitrary_id=st.text(min_size=1, max_size=128))
def test_ids_are_not_auto_generated_for_either_type(arbitrary_id):
    """Property: ``mention_id`` and ``assertion_id`` are caller-supplied
    and survive verbatim. Hypothesis-generate arbitrary strings (including
    UUIDs, hash-shaped strings, free text) and confirm none get rewritten."""
    m = _mention(mention_id=arbitrary_id)
    a = _assertion(assertion_id=arbitrary_id)
    assert m.mention_id == arbitrary_id
    assert a.assertion_id == arbitrary_id
    # Survives JSON round-trip too.
    assert Mention.model_validate_json(m.model_dump_json()).mention_id == arbitrary_id
    assert Assertion.model_validate_json(a.model_dump_json()).assertion_id == arbitrary_id


# ═════════════════════════════════════════════════════════════════════════
# Tier 3 — Differential / cross-package (~3 tests)
# ═════════════════════════════════════════════════════════════════════════


class TestDifferentialCrossPackage:
    def test_reexport_identity_mention(self):
        """``from catalyst_contracts_core import Mention`` must point to the
        same class as ``from catalyst_contracts_core.types import Mention``.
        Catches accidental rebinding via ``__init__.py``."""
        assert pkg.Mention is pkg_types.Mention

    def test_reexport_identity_assertion(self):
        """Same identity check for Assertion."""
        assert pkg.Assertion is pkg_types.Assertion

    def test_reexport_identity_provenance(self):
        """Same identity check for Provenance — relied on by downstream
        type-narrowing code in catalyst-data/dagster-io."""
        assert pkg.Provenance is pkg_types.Provenance

    def test_mention_type_strenum_value_equals_literal(self):
        """``MentionType.PERSON`` is a StrEnum and must equal the literal
        ``"PERSON"`` for use as a ``canonical_type`` value. Pinning this
        guarantees legacy code that still uses the enum keeps working."""
        m_enum = _mention(canonical_type=MentionType.PERSON)
        m_str = _mention(canonical_type="PERSON")
        assert m_enum.canonical_type == m_str.canonical_type == "PERSON"
        # And the JSON serializes as the plain string, not as an enum-repr.
        assert '"canonical_type":"PERSON"' in m_enum.model_dump_json()

    def test_provenance_none_temporal_survives_json(self):
        """A Provenance with ``temporal_start_ms=None`` must serialize as
        ``null`` (not silently coerced to 0). Pin this — downstream code
        treats 0 and None very differently for audio offsets."""
        p = Provenance(
            source_document_id="d",
            chunk_id="c",
            temporal_start_ms=None,
            temporal_end_ms=None,
        )
        m = _mention(provenance=p)
        restored = Mention.model_validate_json(m.model_dump_json())
        assert restored.provenance.temporal_start_ms is None
        assert restored.provenance.temporal_end_ms is None

    def test_extraction_method_strenum_value_in_provenance(self):
        """``Provenance.extraction_method`` accepts both the enum and the
        equivalent string literal — both serialize to the same value."""
        p_enum = Provenance(
            source_document_id="d", chunk_id="c", extraction_method=ExtractionMethod.REGEX
        )
        p_str = Provenance(source_document_id="d", chunk_id="c", extraction_method="regex")
        assert p_enum.extraction_method == p_str.extraction_method == "regex"


# ═════════════════════════════════════════════════════════════════════════
# Tier 4 — Scenario (1 test, multi-assertion)
# ═════════════════════════════════════════════════════════════════════════


class TestAmrMvpThreeAssertionScenario:
    """The AMR MVP demo (``examples/amr_congress_mvp.py``) emits THREE
    assertions for the demo sentence:

        1. introduce-01 → 'sponsors'  (Rep. Smith, H.R. 1234)   polarity=True
        2. refer-01     → 'refers_to' (H.R. 1234, Committee)    polarity=True
        3. report-01    → reports     (Committee, H.R. 1234)    polarity=False

    The dev's Tier 4 test only covers the first. Pin the other two —
    especially the negated one, since polarity=False exercises the
    negated/polarity sync invariant end-to-end through JSON."""

    def test_amr_mvp_three_assertions_all_round_trip(self):
        prov = Provenance(
            source_document_id="doc-mvp-1",
            chunk_id="chunk-0",
            span_start=0,
            span_end=130,
            extraction_method=ExtractionMethod.LLM,
            extraction_model="amr-parser-v1",
            confidence=0.95,
            code_location="catalyst_exgraph.nodes.amr_project",
        )

        introduces = Assertion(
            assertion_id="amr-mvp-introduce",
            subject_text="Rep. Smith",
            predicate="sponsors",
            object_text="H.R. 1234",
            amr_frame="introduce-01",
            amr_variable="i",
            amr_role_mapping={"ARG0": "subject", "ARG1": "object"},
            polarity=True,
            provenance=prov,
        )
        refers_to = Assertion(
            assertion_id="amr-mvp-refer",
            subject_text="H.R. 1234",
            predicate="refers_to",
            object_text="Committee on Energy and Commerce",
            amr_frame="refer-01",
            amr_variable="r",
            amr_role_mapping={"ARG1": "subject", "ARG2": "object"},
            polarity=True,
            provenance=prov,
        )
        # The negated one — corresponds to "but the bill was never reported".
        # polarity=False exercises the sync validator: negated must come out True.
        reported_by = Assertion(
            assertion_id="amr-mvp-report",
            subject_text="Committee on Energy and Commerce",
            predicate="reports",
            object_text="H.R. 1234",
            amr_frame="report-01",
            amr_variable="rep",
            amr_role_mapping={"ARG0": "subject", "ARG1": "object"},
            polarity=False,
            provenance=prov,
        )

        # Sanity: the negated mirror invariant fired on construction.
        assert introduces.negated is False
        assert refers_to.negated is False
        assert reported_by.negated is True

        # All three round-trip through JSON cleanly.
        for original in (introduces, refers_to, reported_by):
            blob = original.model_dump_json()
            restored = Assertion.model_validate_json(blob)
            assert restored == original
            assert restored.amr_frame == original.amr_frame
            assert restored.polarity == original.polarity
            assert restored.negated == (not original.polarity)
            assert restored.provenance.source_document_id == "doc-mvp-1"
            assert restored.amr_role_mapping == original.amr_role_mapping
