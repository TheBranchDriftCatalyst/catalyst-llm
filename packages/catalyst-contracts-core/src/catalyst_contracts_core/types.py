"""Shared base types used across the KG pipeline."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from catalyst_contracts_core.enums import ExtractionMethod


class Provenance(BaseModel):
    """Tracks where an extraction came from, including source document, method, and confidence."""

    source_document_id: str = Field(description="ID of the source document this extraction came from")
    chunk_id: str = Field(description="ID of the chunk within the source document")
    span_start: int | None = Field(default=None, description="Character offset where the extracted span starts")
    span_end: int | None = Field(default=None, description="Character offset where the extracted span ends")
    temporal_start_ms: int | None = Field(
        default=None,
        description="Milliseconds into source media where extraction starts (audio/video only)",
    )
    temporal_end_ms: int | None = Field(
        default=None,
        description="Milliseconds into source media where extraction ends (audio/video only)",
    )
    speaker_label: str | None = Field(
        default=None,
        description="Session-local speaker ID from diarization (e.g. SPEAKER_00)",
    )
    source_media_uri: str | None = Field(default=None, description="URI of the original audio/video source file")
    extraction_method: ExtractionMethod = Field(
        default=ExtractionMethod.LLM,
        description="Method used for extraction: llm, spacy, regex, manual, or structured",
    )
    extraction_model: str = Field(default="", description="Name/ID of the model used for extraction")
    confidence: float = Field(
        default=1.0,
        ge=0,
        le=1,
        description="Confidence score for this extraction, between 0 and 1",
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="ISO 8601 timestamp of when this extraction was performed",
    )
    code_location: str = Field(default="", description="Dagster code location that produced this extraction")


class Mention(BaseModel):
    """A named entity mention — the wire shape persisted to the gold layer.

    Carries consensus provenance (which NER voters agreed on it) AND optional
    canonical entity linking (which CanonicalEntity it resolves to after
    cross-source alignment).

    Replaces both ``catalyst_exgraph.models.extraction_output.MentionCandidate``
    (the raw NER schema) AND ``dagster_io.models.Mention`` (the persisted wire
    shape). One type for both purposes.

    Wire-shape contract:
      * ``frozen=True`` — mentions are emit-and-forget; downstream nodes must
        never mutate them in place.
      * ``extra="forbid"`` — unknown fields are a contract leak; reject them.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    # ── Identity ────────────────────────────────────────────────────────
    mention_id: str = Field(
        description="Stable hash of (canonical_text, canonical_type, span_start).",
    )

    # ── Surface + classification ────────────────────────────────────────
    text: str = Field(description="The exact surface form as it appears in the source text.")
    canonical_type: str = Field(
        min_length=1,
        description=(
            "Canonical entity type from the active label pack. Free-form str "
            "(intentionally not the MentionType enum) so label packs can extend "
            "the universe (e.g. BILL, PUBLIC_LAW from the 'congress' pack). "
            "Empty string is rejected — a mention must have a type."
        ),
    )
    span_start: int = Field(
        ge=0,
        description="Character offset where the mention starts in the source text.",
    )
    span_end: int = Field(description="Character offset where the mention ends in the source text.")

    # ── Consensus provenance (from the NER ensemble + ConsensusNode) ────
    vote_count: int = Field(
        default=1,
        description="How many encoders voted for this mention.",
    )
    n_encoders: int = Field(
        default=1,
        ge=1,
        description="How many encoders ran for this consensus pass. Must be >= 1: "
        "a mention came from at least one encoder.",
    )
    source_models: list[str] = Field(
        default_factory=list,
        description="Which encoders contributed votes for this mention.",
    )
    mean_confidence: float = Field(
        default=1.0,
        ge=0,
        le=1,
        description="Mean confidence across the voting encoders.",
    )
    span_provenance: str | None = Field(
        default=None,
        description="Which encoder's span won the consensus tie-break.",
    )

    # ── Entity linking (optional — populated post-concordance) ─────────
    canonical_entity_id: str | None = Field(
        default=None,
        description="ID of the CanonicalEntity this mention resolves to after "
        "cross-source alignment. None until concordance runs.",
    )

    # ── Audit ───────────────────────────────────────────────────────────
    context: str = Field(
        default="",
        description="Surrounding sentence fragment for QA/debugging.",
    )
    content_hash: str = Field(
        default="",
        description="Deduplication hash over the canonical content.",
    )
    provenance: Provenance = Field(
        description="Source anchoring — every mention has a source.",
    )

    @model_validator(mode="after")
    def _validate_span_order(self) -> Mention:
        """``span_end`` must be >= ``span_start``. A negative-width span is a
        garbage extraction; reject it at construction so downstream code can
        assume well-formed offsets."""
        if self.span_end < self.span_start:
            raise ValueError(
                f"span_end ({self.span_end}) must be >= span_start ({self.span_start})"
            )
        return self


class Assertion(BaseModel):
    """A proposition — the wire shape persisted to the gold layer.

    Flat SPO view (``subject_text`` / ``predicate`` / ``object_text``) for fast
    queries. AMR-rich fields (``amr_frame``, ``polarity``, ``modality``,
    ``qualifiers``) for graph-native semantics. ``provenance`` for source
    anchoring. Temporal validity + entity refs are placeholders for follow-up
    beads.

    Replaces both ``catalyst_exgraph.models.amr_assertion.AmrAssertion`` (the
    projection output) AND ``dagster_io.models.Assertion`` (the flat SPO wire
    shape). Single canonical shape.

    Wire-shape contract:
      * ``frozen=True`` — assertions are emit-and-forget.
      * ``extra="forbid"`` — unknown fields are a contract leak; reject them.
      * ``negated`` is kept in sync with ``not polarity`` by a post-validator
        — see the docstring on ``negated`` for the legacy-mirror contract.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    # ── Identity ────────────────────────────────────────────────────────
    assertion_id: str = Field(
        description="Stable hash of (subject, predicate, object, source_chunk_id).",
    )

    # ── Flat SPO view (the lowest-common-denominator export shape) ─────
    subject_text: str = Field(description="Surface form of the subject argument (typically ARG0).")
    predicate: str = Field(
        min_length=1,
        description="Canonical predicate from the active label pack's predicate vocab. "
        "Empty string is rejected — an assertion must have a predicate.",
    )
    object_text: str | None = Field(
        default=None,
        description="Surface form of the object argument (typically ARG1). "
        "None for intransitive predicates (e.g. pass-03 with only ARG1).",
    )

    # ── Entity links (optional — populated post-concordance) ───────────
    subject_entity_id: str | None = Field(
        default=None,
        description="ID of the CanonicalEntity for the subject. None until concordance.",
    )
    object_entity_id: str | None = Field(
        default=None,
        description="ID of the CanonicalEntity for the object. None until concordance.",
    )
    subject_mention_id: str | None = Field(
        default=None,
        description="ID of the Mention that anchored the subject argument.",
    )
    object_mention_id: str | None = Field(
        default=None,
        description="ID of the Mention that anchored the object argument.",
    )

    # ── AMR provenance (where the predicate came from) ─────────────────
    amr_frame: str | None = Field(
        default=None,
        description="Raw PropBank frame from the AMR :instance edge, e.g. 'introduce-01'.",
    )
    amr_variable: str | None = Field(
        default=None,
        description="AMR variable for the predicate node, e.g. 'i' in (i / introduce-01).",
    )
    amr_role_mapping: dict[str, str] = Field(
        default_factory=dict,
        description="AMR ARG → semantic role mapping actually applied, "
        "e.g. {'ARG0': 'subject', 'ARG1': 'object'}.",
    )
    is_novel_predicate: bool = Field(
        default=False,
        description="True when the AMR frame was not in pack.amr_frames.frames.",
    )

    # ── Modality + polarity (AMR graph attributes) ─────────────────────
    polarity: bool = Field(
        default=True,
        description="False when the AMR graph carried ':polarity -'.",
    )
    modality: str | None = Field(
        default=None,
        description="Value of the AMR ':mode' attribute (e.g. 'possible', 'obligation').",
    )
    negated: bool = Field(
        default=False,
        description="Legacy mirror of !polarity for old consumers.",
    )
    hedged: bool = Field(
        default=False,
        description="True for 'may' / 'could' / 'reportedly' markers.",
    )

    # ── Qualifiers (n-ary edge metadata) ───────────────────────────────
    qualifiers: dict[str, str] = Field(
        default_factory=dict,
        description="Adjunct edges projected as qualifiers: :time, :location, "
        ":condition, :manner, source_attribution. Keys are role names; values "
        "are surface forms resolved from the target variable.",
    )

    # ── Temporal validity (PLACEHOLDER — stamping is bead llm-mln) ─────
    t_valid_from: str | None = Field(
        default=None,
        description="ISO date when the fact starts holding. None until stamping runs.",
    )
    t_valid_until: str | None = Field(
        default=None,
        description="ISO date when the fact stops holding. None means open-ended.",
    )
    is_atemporal: bool = Field(
        default=False,
        description="True for facts that don't have temporal validity "
        "(cites/amends/repeals/codifies). Logically incompatible with t_valid_from/until.",
    )

    # ── Geospatial grounding (PLACEHOLDER — future H3/GeoSPARQL bead) ──
    h3_cells: list[str] = Field(
        default_factory=list,
        description="H3 cell IDs for spatial indexing. Empty until grounding runs.",
    )
    geometry_geojson: dict[str, Any] | None = Field(
        default=None,
        description="Raw GeoJSON geometry, when available.",
    )

    # ── Source pointers ────────────────────────────────────────────────
    sentence_index: int | None = Field(
        default=None,
        description="Index of the sentence in the chunk this projection came from.",
    )
    sentence_char_start: int | None = Field(
        default=None,
        description="Char offset (in the chunk) where the source sentence begins.",
    )
    sentence_char_end: int | None = Field(
        default=None,
        description="Char offset (in the chunk) where the source sentence ends.",
    )

    # ── Confidence + provenance ────────────────────────────────────────
    confidence: float = Field(
        default=1.0,
        ge=0,
        le=1,
        description="Confidence in this assertion, between 0 and 1.",
    )
    content_hash: str = Field(
        default="",
        description="Deduplication hash over the canonical content.",
    )
    provenance: Provenance = Field(
        description="Source anchoring — every assertion has a source.",
    )

    @model_validator(mode="after")
    def _sync_negated_with_polarity(self) -> Assertion:
        """``negated`` is the legacy mirror of ``!polarity`` (see the field
        docstring). Anything that isn't ``negated == not polarity`` is
        inconsistent — force the invariant post-construction so callers can
        rely on it.

        Because the model is ``frozen=True``, we use ``object.__setattr__``
        to update the field. This runs at the end of validation, before the
        model is exposed to the caller — so the immutability contract is
        preserved.
        """
        expected_negated = not self.polarity
        if self.negated != expected_negated:
            object.__setattr__(self, "negated", expected_negated)
        return self
