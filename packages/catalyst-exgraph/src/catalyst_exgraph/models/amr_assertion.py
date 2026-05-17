"""AMR-derived assertion model.

Output of ``AmrToAssertionNode`` (catalyst_exgraph.nodes.amr_project). Each
``AmrAssertion`` is one predicate node projected out of an AMR graph: a
flat ``(subject, predicate, object)`` view alongside the AMR provenance
(frame, role mapping, modality, qualifiers) so downstream consumers can
pick whichever representation they need.

This lives alongside (not inside) catalyst-data's ``Assertion`` resource
— that one is the persistence target; this one is the in-flight projection
record.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AmrAssertion(BaseModel):
    """An assertion derived from an AMR graph projection.

    Carries the AMR provenance (frame, role mappings) alongside the flat
    (subject, predicate, object) view so downstream consumers can choose
    either level of representation.
    """

    # ── Flat view — fast queries, legacy consumers ──────────────────────
    subject_text: str = Field(
        description="Surface form of the subject argument (typically ARG0).",
    )
    predicate: str = Field(
        description="Canonical predicate resolved from pack.amr_frames.frames.",
    )
    object_text: str | None = Field(
        default=None,
        description="Surface form of the object argument (typically ARG1). "
        "None for intransitive frames or when ARG1 was absent from the AMR.",
    )

    # ── AMR provenance — what we did to get here ─────────────────────────
    amr_frame: str = Field(
        description="Raw PropBank frame from the AMR :instance edge, e.g. 'introduce-01'.",
    )
    amr_variable: str = Field(
        description="AMR variable for the predicate node, e.g. 'i' in (i / introduce-01).",
    )
    amr_role_mapping: dict[str, str] = Field(
        default_factory=dict,
        description="AMR ARG → semantic role mapping actually applied, "
        "e.g. {'ARG0': 'subject', 'ARG1': 'object'}.",
    )

    # ── Modality + polarity — straight from AMR graph attributes ─────────
    polarity: bool = Field(
        default=True,
        description="False when the AMR graph carried ':polarity -'.",
    )
    modality: str | None = Field(
        default=None,
        description="Value of the AMR ':mode' attribute (e.g. 'possible', 'obligation').",
    )

    # ── Qualifiers — from AMR adjunct edges ──────────────────────────────
    qualifiers: dict[str, str] = Field(
        default_factory=dict,
        description="Adjunct edges projected as qualifiers: keys are role names "
        "like 'time', 'location', 'condition', 'manner'; values are surface "
        "forms resolved from the target variable.",
    )

    # ── Confidence + novelty ─────────────────────────────────────────────
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence in this projection. 1.0 for known frames, "
        "lower when the frame was unknown / passed through / novel.",
    )
    is_novel_predicate: bool = Field(
        default=False,
        description="True when the AMR frame was not in pack.amr_frames.frames "
        "and was emitted as NOVEL_{frame} via the 'novel' unknown_frame_action.",
    )

    # ── Source pointers ──────────────────────────────────────────────────
    sentence_index: int = Field(
        ge=0,
        description="Index of the sentence in the chunk this projection came from.",
    )
    sentence_char_start: int = Field(
        ge=0,
        description="Char offset (in the chunk) where the source sentence begins.",
    )
    sentence_char_end: int = Field(
        ge=0,
        description="Char offset (in the chunk) where the source sentence ends.",
    )
    canonical_entity_refs: dict[str, str] = Field(
        default_factory=dict,
        description="AMR variable → canonical entity ID, resolved against the "
        "NER consensus mentions. Empty when no consensus match was found.",
    )
