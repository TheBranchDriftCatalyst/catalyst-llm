"""Shared enums used across the KG pipeline."""

from enum import StrEnum


class MentionType(StrEnum):
    """Convenience vocabulary for common entity types.

    NOTE: As of the unified-domain-model refactor, this enum is a *convenience*
    vocabulary only. The canonical wire shape ``Mention.canonical_type`` is
    intentionally ``str`` (not ``MentionType``) so label packs can extend the
    universe (e.g. the 'congress' pack adds BILL, PUBLIC_LAW, COMMITTEE_REF,
    AMENDMENT, etc.). Existing code that still references ``MentionType.PERSON``
    or any of these values keeps working because ``StrEnum`` values are plain
    strings — they compare equal to the literal "PERSON".
    """

    PERSON = "PERSON"
    ORG = "ORG"
    GPE = "GPE"
    LOC = "LOC"
    DATE = "DATE"
    LAW = "LAW"
    EVENT = "EVENT"
    MONEY = "MONEY"
    NORP = "NORP"
    FACILITY = "FACILITY"
    DOCUMENT = "DOCUMENT"
    BOOK = "BOOK"
    ROLE = "ROLE"
    # Geopolitical/strategic domain
    STRATEGIC_ASSET = "STRATEGIC_ASSET"  # chokepoints, pipelines, trade routes, military bases
    # Finance domain
    FINANCIAL_INSTRUMENT = "FINANCIAL_INSTRUMENT"  # stocks, bonds, derivatives, funds
    OTHER = "OTHER"


class AlignmentType(StrEnum):
    SAME_AS = "sameAs"
    POSSIBLE_SAME_AS = "possibleSameAs"
    RELATED_TO = "relatedTo"
    PART_OF = "partOf"


class ExtractionMethod(StrEnum):
    LLM = "llm"
    SPACY = "spacy"
    REGEX = "regex"
    MANUAL = "manual"
    STRUCTURED = "structured"
    # AMR-as-spine projection — deterministic graph walk over PENMAN +
    # canonical-predicate lookup against pack.amr_frames. Distinct from
    # STRUCTURED because the source is a parser's symbolic graph, not an
    # LLM's structured-output call.
    AMR_PROJECTION = "amr_projection"
    # Multi-voter NER ensemble — the consensus output of N encoder
    # clients run in parallel (GLiNER + NuExtract + UniversalNER + Regex).
    NER_ENSEMBLE = "ner_ensemble"
