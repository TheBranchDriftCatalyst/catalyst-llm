"""Canonical LLM output models for structured extraction.

These models define the exact schema that LLMs must emit when using
``with_structured_output()``.  Field names match what the validators expect
(``text``, ``mention_type``, ``span_start``, ``span_end``), eliminating the
field-name mismatch that occurs with free-form prompting.

The Pydantic class name, docstring, and Field descriptions are all injected
into the tool/function schema the LLM sees, so they serve as both documentation
and prompt engineering.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class MentionCandidate(BaseModel):
    """A single named entity mention extracted from source text."""

    text: str = Field(description="The exact surface form as it appears in the source text")
    mention_type: str = Field(
        description=(
            "Canonical entity type from the active label pack. The bundled 'generic' "
            "pack uses PERSON, ORG, GPE, LOC, DATE, LAW, EVENT, MONEY, NORP, FACILITY, "
            "DOCUMENT, BOOK, ROLE, STRATEGIC_ASSET, FINANCIAL_INSTRUMENT, OTHER. "
            "Domain packs extend this — e.g. the 'congress' pack adds BILL, "
            "PUBLIC_LAW, COMMITTEE_REF, AMENDMENT, SECTION_REF, ROLL_CALL_VOTE, "
            "VOTE_RESULT, SPONSOR_ROLE, POLICY_AREA, LAW_CITATION."
        )
    )
    span_start: int = Field(
        ge=0,
        description="Character offset where the mention starts in the source text",
    )
    span_end: int = Field(description="Character offset where the mention ends in the source text")
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence score for this extraction, between 0 and 1",
    )


class MentionExtractionResult(BaseModel):
    """Result of entity mention extraction from text.

    Return a JSON object with a ``mentions`` array containing all named entity
    mentions found in the source text.
    """

    mentions: list[MentionCandidate] = Field(description="All named entity mentions extracted from the source text")
