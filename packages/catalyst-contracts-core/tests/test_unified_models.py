"""Pyramid-coverage tests for the unified Mention + Assertion wire shapes.

Tier 1: adversarial — boundary + invalid-input cases
Tier 2: property-based round-trip via hypothesis
Tier 3: differential — JSON serialization round-trip parity
Tier 4: scenario — the AMR MVP demo assertion, end-to-end
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from catalyst_contracts_core.enums import MentionType
from catalyst_contracts_core.types import Assertion, Mention, Provenance


# ─────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────


def _prov(**overrides) -> Provenance:
    """Minimal valid Provenance for use as a test fixture."""
    defaults = {"source_document_id": "doc-1", "chunk_id": "chunk-1"}
    defaults.update(overrides)
    return Provenance(**defaults)


# ─────────────────────────────────────────────────────────────────────────
# Tier 1: Adversarial
# ─────────────────────────────────────────────────────────────────────────


class TestAdversarialMention:
    def test_accepts_non_enum_canonical_type(self):
        """Mention.canonical_type is intentionally str — label packs extend
        the universe with values like 'BILL' that are not in MentionType."""
        m = Mention(
            mention_id="m-1",
            text="H.R. 1234",
            canonical_type="BILL",
            span_start=0,
            span_end=9,
            provenance=_prov(),
        )
        assert m.canonical_type == "BILL"
        assert m.content_hash == ""  # default

    def test_negative_span_start_raises(self):
        with pytest.raises(ValidationError):
            Mention(
                mention_id="m-1",
                text="x",
                canonical_type="PERSON",
                span_start=-1,
                span_end=1,
                provenance=_prov(),
            )

    def test_mean_confidence_above_one_raises(self):
        with pytest.raises(ValidationError):
            Mention(
                mention_id="m-1",
                text="x",
                canonical_type="PERSON",
                span_start=0,
                span_end=1,
                mean_confidence=1.5,
                provenance=_prov(),
            )

    def test_provenance_required(self):
        """provenance has no default — must be supplied."""
        with pytest.raises(ValidationError):
            Mention(
                mention_id="m-1",
                text="x",
                canonical_type="PERSON",
                span_start=0,
                span_end=1,
            )  # type: ignore[call-arg]


class TestAdversarialAssertion:
    def test_confidence_above_one_rejected(self):
        with pytest.raises(ValidationError):
            Assertion(
                assertion_id="a-1",
                subject_text="x",
                predicate="p",
                object_text="y",
                confidence=1.5,
                provenance=_prov(),
            )

    def test_polarity_false_with_negated_true_is_consistent(self):
        """polarity=False and negated=True together is logically consistent
        (negated is the legacy mirror of !polarity). Both should be accepted."""
        a = Assertion(
            assertion_id="a-1",
            subject_text="x",
            predicate="vote",
            object_text="y",
            polarity=False,
            negated=True,
            provenance=_prov(),
        )
        assert a.polarity is False
        assert a.negated is True

    def test_empty_qualifiers_dict_default(self):
        a = Assertion(
            assertion_id="a-1",
            subject_text="x",
            predicate="p",
            object_text=None,
            provenance=_prov(),
        )
        assert a.qualifiers == {}

    def test_is_atemporal_with_t_valid_from_set(self):
        """is_atemporal=True with t_valid_from set is a logical contradiction —
        a downstream validator (bead llm-mln) is responsible for catching this.
        At the model layer we accept it; this test pins down that behavior."""
        a = Assertion(
            assertion_id="a-1",
            subject_text="Congress",
            predicate="amends",
            object_text="H.R. 1",
            is_atemporal=True,
            t_valid_from="2025-01-01",
            provenance=_prov(),
        )
        assert a.is_atemporal is True
        assert a.t_valid_from == "2025-01-01"

    def test_object_text_optional_for_intransitive(self):
        a = Assertion(
            assertion_id="a-1",
            subject_text="H.R. 1234",
            predicate="passes",
            object_text=None,
            provenance=_prov(),
        )
        assert a.object_text is None


# ─────────────────────────────────────────────────────────────────────────
# Tier 2: Property-based round-trip (hypothesis)
# ─────────────────────────────────────────────────────────────────────────


@given(
    mention_id=st.text(min_size=1, max_size=32),
    text=st.text(min_size=1, max_size=64),
    canonical_type=st.text(min_size=1, max_size=32),
    span_start=st.integers(min_value=0, max_value=10_000),
    span_len=st.integers(min_value=1, max_value=200),
    vote_count=st.integers(min_value=1, max_value=10),
    mean_confidence=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
)
def test_mention_json_round_trip(
    mention_id, text, canonical_type, span_start, span_len, vote_count, mean_confidence
):
    m = Mention(
        mention_id=mention_id,
        text=text,
        canonical_type=canonical_type,
        span_start=span_start,
        span_end=span_start + span_len,
        vote_count=vote_count,
        mean_confidence=mean_confidence,
        provenance=_prov(),
    )
    blob = m.model_dump_json()
    restored = Mention.model_validate_json(blob)
    assert restored == m


@given(
    assertion_id=st.text(min_size=1, max_size=32),
    subject_text=st.text(min_size=1, max_size=64),
    predicate=st.text(min_size=1, max_size=32),
    object_text=st.one_of(st.none(), st.text(min_size=1, max_size=64)),
    polarity=st.booleans(),
    confidence=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
)
def test_assertion_json_round_trip(
    assertion_id, subject_text, predicate, object_text, polarity, confidence
):
    a = Assertion(
        assertion_id=assertion_id,
        subject_text=subject_text,
        predicate=predicate,
        object_text=object_text,
        polarity=polarity,
        confidence=confidence,
        provenance=_prov(),
    )
    blob = a.model_dump_json()
    restored = Assertion.model_validate_json(blob)
    assert restored == a


def test_content_hash_default_consistent():
    """content_hash defaults to "" on every fresh instance, deterministically."""
    for _ in range(3):
        m = Mention(
            mention_id="m",
            text="t",
            canonical_type="PERSON",
            span_start=0,
            span_end=1,
            provenance=_prov(),
        )
        assert m.content_hash == ""
        a = Assertion(
            assertion_id="a",
            subject_text="s",
            predicate="p",
            object_text="o",
            provenance=_prov(),
        )
        assert a.content_hash == ""


# ─────────────────────────────────────────────────────────────────────────
# Tier 3: Differential — JSON parity + enum/string equivalence
# ─────────────────────────────────────────────────────────────────────────


class TestDifferential:
    def test_mention_round_trip_through_json(self):
        m = Mention(
            mention_id="m-1",
            text="Rep. Smith",
            canonical_type="PERSON",
            span_start=0,
            span_end=10,
            vote_count=3,
            n_encoders=3,
            source_models=["spacy", "flair", "gliner"],
            mean_confidence=0.92,
            span_provenance="flair",
            canonical_entity_id="ent-42",
            context="...Rep. Smith introduced H.R. 1234 on Monday...",
            content_hash="abc123",
            provenance=_prov(),
        )
        blob = m.model_dump_json()
        restored = Mention.model_validate_json(blob)
        assert restored == m

    def test_assertion_round_trip_through_json(self):
        a = Assertion(
            assertion_id="a-1",
            subject_text="Rep. Smith",
            predicate="introduces",
            object_text="H.R. 1234",
            subject_entity_id="ent-42",
            object_entity_id="ent-99",
            amr_frame="introduce-01",
            amr_variable="i",
            amr_role_mapping={"ARG0": "subject", "ARG1": "object"},
            polarity=True,
            modality=None,
            qualifiers={"time": "Monday"},
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=44,
            confidence=0.95,
            content_hash="def456",
            provenance=_prov(),
        )
        blob = a.model_dump_json()
        restored = Assertion.model_validate_json(blob)
        assert restored == a

    def test_canonical_type_accepts_enum_value_and_literal_string(self):
        """MentionType.OTHER and the literal string 'OTHER' should both be
        accepted as canonical_type, and produce equal models."""
        m_from_enum = Mention(
            mention_id="m-1",
            text="x",
            canonical_type=MentionType.OTHER,  # StrEnum coerces to "OTHER"
            span_start=0,
            span_end=1,
            provenance=_prov(),
        )
        m_from_str = Mention(
            mention_id="m-1",
            text="x",
            canonical_type="OTHER",
            span_start=0,
            span_end=1,
            provenance=_prov(),
        )
        # Both should serialize to the same string value
        assert m_from_enum.canonical_type == "OTHER"
        assert m_from_str.canonical_type == "OTHER"
        # Models compare equal (timestamps in provenance differ by microseconds,
        # so compare just the canonical_type rather than the whole models)
        assert m_from_enum.canonical_type == m_from_str.canonical_type


# ─────────────────────────────────────────────────────────────────────────
# Tier 4: Scenario — AMR MVP demo assertion
# ─────────────────────────────────────────────────────────────────────────


class TestAmrMvpScenario:
    def test_amr_mvp_demo_assertion_round_trip(self):
        """The exact assertion the AMR MVP demo emits — ensure every field
        serializes cleanly through JSON and back."""
        prov = Provenance(
            source_document_id="doc-mvp-1",
            chunk_id="chunk-0",
            span_start=0,
            span_end=44,
            extraction_model="amr-parser-v1",
            confidence=0.95,
            code_location="catalyst_exgraph.nodes.amr_project",
        )
        a = Assertion(
            assertion_id="amr-mvp-1",
            subject_text="Rep. Smith",
            predicate="introduces",
            object_text="H.R. 1234",
            amr_frame="introduce-01",
            amr_variable="i",
            amr_role_mapping={"ARG0": "subject", "ARG1": "object"},
            is_novel_predicate=False,
            polarity=True,
            modality=None,
            negated=False,
            hedged=False,
            qualifiers={},
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=44,
            confidence=0.95,
            provenance=prov,
        )
        blob = a.model_dump_json()
        restored = Assertion.model_validate_json(blob)
        assert restored == a
        assert restored.subject_text == "Rep. Smith"
        assert restored.predicate == "introduces"
        assert restored.object_text == "H.R. 1234"
        assert restored.amr_frame == "introduce-01"
        assert restored.polarity is True
        assert restored.provenance.source_document_id == "doc-mvp-1"
