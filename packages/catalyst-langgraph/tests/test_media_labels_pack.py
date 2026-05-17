"""Tests for the media-ingest LabelPack.

Mirrors the shape of ``test_label_packs.py::test_congress_pack_has_amr_frame_mappings``
but tuned for transcribed audio/video content. The pack lives in
``catalyst-data/k8s/media-ingest/prompts/media.labels.yaml`` and is
loaded by catalyst-exgraph at pipeline build time.

The non-tautological cross-validation test parses the canonical predicate
list out of ``proposition_extraction.prompt`` and confirms every value
the AMR frame table targets is declared there — so the YAML cannot drift
silently from the SPO prompt's controlled vocabulary.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from catalyst_langgraph.label_packs import load_label_pack

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution + skip-if-absent guard
# ─────────────────────────────────────────────────────────────────────────────
_MEDIA_PROMPT_DIR = Path(
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/media-ingest/prompts"
)
_MEDIA_PACK_PATH = _MEDIA_PROMPT_DIR / "media.labels.yaml"
_PROPOSITION_PROMPT_PATH = _MEDIA_PROMPT_DIR / "proposition_extraction.prompt"


def _require_media_pack():
    if not _MEDIA_PACK_PATH.is_file():
        pytest.skip("media-ingest pack not present in this env")


def _load_media_pack():
    _require_media_pack()
    return load_label_pack(_MEDIA_PROMPT_DIR, "media")


# ─────────────────────────────────────────────────────────────────────────────
# Structural smoke tests
# ─────────────────────────────────────────────────────────────────────────────
def test_media_pack_loads():
    """Sanity: pack loads, claims the right domain, and has all five voter
    sections populated."""
    pack = _load_media_pack()
    assert pack.name == "media"
    assert pack.domain == "media-ingest"
    assert pack.has_gliner_labels()
    assert pack.has_nuextract_template()
    assert pack.has_universalner_queries()
    assert pack.has_regex_patterns()
    assert pack.has_amr_frames()


def test_media_pack_canonical_types_include_speaker():
    """SPEAKER is the media-ingest-specific addition — it routes diarization
    labels (SPEAKER_00, …) into a distinct slot for the projection node."""
    pack = _load_media_pack()
    assert "SPEAKER" in pack.canonical_types
    # And the rest of the union from mention_extraction.prompt:
    for ct in [
        "PERSON", "ORG", "GPE", "LOC", "DATE", "EVENT", "MONEY", "LAW",
        "NORP", "FACILITY", "DOCUMENT", "BOOK", "ROLE",
        "STRATEGIC_ASSET", "FINANCIAL_INSTRUMENT", "OTHER",
    ]:
        assert ct in pack.canonical_types


def test_media_pack_gliner_has_at_least_20_labels():
    """Descriptive labels for the bi-encoder. ≥20 keeps parity with the
    congress pack and the geopolitical/financial domain coverage."""
    pack = _load_media_pack()
    assert len(pack.gliner.labels) >= 20
    # Every gliner label resolves to a canonical type that's in the universe.
    for label, canonical in pack.gliner.labels.items():
        assert canonical in pack.canonical_types, (
            f"{label!r} → {canonical} not in canonical_types"
        )
    # GLiNER threshold dropped to 0.3 because descriptive labels score lower.
    assert pack.gliner.threshold == pytest.approx(0.3)


def test_media_pack_regex_authoritative_for_speaker_and_money():
    """SPEAKER patterns are the only reliable detector for diarization tags
    (model voters are trained to ignore them); MONEY's $-gate is high enough
    precision to outrank model voters."""
    pack = _load_media_pack()
    assert "SPEAKER" in pack.regex.authoritative_for
    assert "MONEY" in pack.regex.authoritative_for
    # SPEAKER pattern is mandatory.
    assert "SPEAKER" in pack.regex.patterns


def test_media_pack_amr_frames_core_speech_acts():
    """Three core speech-act and action frames must be present — these are
    the most common AMR predicates in transcribed content."""
    pack = _load_media_pack()
    assert pack.amr_frames.frames["say-01"] == "states"
    assert pack.amr_frames.frames["deny-01"] == "denies"
    assert pack.amr_frames.frames["own-01"] == "owns"


def test_media_pack_amr_role_override_for_speaker_attribution():
    """Speech-act frames carry ARG2 = source_attribution so the projection
    node surfaces "according to X" as a qualifier rather than emitting a
    spurious second triple."""
    pack = _load_media_pack()
    assert (
        pack.amr_frames.role_overrides["say-01"]["ARG2"]
        == "source_attribution"
    )


def test_media_pack_nuextract_has_claims_path():
    """The speech-act schema is the distinguishing feature of the media
    pack's NuExtract template — at least one Claims[].* leaf must be
    declared in canonical_type_map."""
    pack = _load_media_pack()
    claim_paths = [
        k for k in pack.nuextract.canonical_type_map if k.startswith("Claims[].")
    ]
    assert claim_paths, "expected at least one Claims[].* path in canonical_type_map"


def test_media_pack_universalner_multi_probe_for_person_and_strategic_asset():
    """Domain-specific subtypes recall better than generic heads — verify
    multi-probe queries for the types where this matters most."""
    pack = _load_media_pack()
    assert len(pack.universalner.queries.get("PERSON", [])) >= 2
    assert len(pack.universalner.queries.get("STRATEGIC_ASSET", [])) >= 2
    # assistant_prime must stay verbatim — UniNER training distribution.
    assert pack.universalner.assistant_prime == "I've read this text."


# ─────────────────────────────────────────────────────────────────────────────
# Non-tautological cross-validation tests
# ─────────────────────────────────────────────────────────────────────────────
def _parse_canonical_predicates_from_prompt(prompt_path: Path) -> set[str]:
    """Extract the canonical predicate list from proposition_extraction.prompt.

    The prompt declares two predicate groups under "## Canonical Predicates":
      - speech-act predicates (states, claims, denies, …)
      - action predicates (owns, operates, leads, …)
    We parse the section between "## Canonical Predicates" and the next "##"
    heading, then pull every comma-separated bare-word token.
    """
    text = prompt_path.read_text(encoding="utf-8")
    # Carve out the canonical predicates block.
    match = re.search(
        r"## Canonical Predicates\s*\n(.*?)\n##\s",
        text,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError(
            "could not find '## Canonical Predicates' section in "
            f"{prompt_path}"
        )
    block = match.group(1)
    # Tokens are lowercase identifiers with optional underscores, separated
    # by commas / whitespace. The block also contains section sub-headers
    # like "For speech acts:" — those have colons and word breaks, so the
    # identifier regex naturally skips them.
    tokens = re.findall(r"\b[a-z][a-z_]*\b", block)
    # Filter out the header connectives ("for", "speech", "acts",
    # "actions", "relationships") — they appear in the labels, not the
    # predicate list itself.
    non_predicates = {"for", "speech", "acts", "actions", "relationships"}
    return {t for t in tokens if t not in non_predicates}


def test_media_amr_predicates_subset_of_proposition_prompt():
    """Every canonical predicate the AMR frame table targets MUST appear in
    proposition_extraction.prompt's declared canonical predicate list.

    This is the cross-validation gate: if it fails, the YAML has drifted
    from the SPO prompt — fix the YAML, not the test.
    """
    _require_media_pack()
    if not _PROPOSITION_PROMPT_PATH.is_file():
        pytest.skip("media-ingest proposition_extraction.prompt not present")

    pack = _load_media_pack()
    declared_predicates = _parse_canonical_predicates_from_prompt(
        _PROPOSITION_PROMPT_PATH
    )
    # Sanity: we actually parsed something plausible.
    assert {"states", "claims", "owns"} <= declared_predicates, (
        "predicate parser returned an implausible set: "
        f"{sorted(declared_predicates)}"
    )

    amr_predicates = set(pack.amr_frames.frames.values())
    orphans = amr_predicates - declared_predicates
    assert not orphans, (
        f"AMR frame table targets predicates not declared in "
        f"proposition_extraction.prompt: {sorted(orphans)}"
    )


def test_media_speaker_regex_matches_diarization_labels_only():
    """SPEAKER regex must fire on SPEAKER_00, SPEAKER_42, Speaker 1 and
    NOT on the literal word 'speaker' (which appears in normal prose)."""
    _require_media_pack()
    pack = _load_media_pack()
    patterns = pack.regex.patterns.get("SPEAKER", [])
    assert patterns, "expected at least one SPEAKER regex pattern"
    compiled = [re.compile(p) for p in patterns]

    def fires(text: str) -> bool:
        return any(rx.search(text) for rx in compiled)

    # Positive cases — diarization labels.
    assert fires("SPEAKER_00 said hello")
    assert fires("[SPEAKER_42] interrupts the panel")
    assert fires("Speaker 1 responded")
    # Negative case — the literal word in prose. The leading word "The"
    # plus lowercase "speaker" with no digit must NOT match.
    assert not fires("The speaker addressed the audience")
    assert not fires("a speaker for the foundation")


def test_media_money_regex_requires_dollar_prefix():
    """MONEY regex's $-prefix is the discriminator: it must fire on
    '$1.5 trillion' / '$200 million' but NOT on 'Senate Bill 200'
    (the $-requirement is the whole point of the pattern's precision)."""
    _require_media_pack()
    pack = _load_media_pack()
    patterns = pack.regex.patterns.get("MONEY", [])
    assert patterns, "expected at least one MONEY regex pattern"
    compiled = [re.compile(p) for p in patterns]

    def fires(text: str) -> bool:
        return any(rx.search(text) for rx in compiled)

    assert fires("the deal was worth $1.5 trillion")
    assert fires("$200 million was allocated")
    assert fires("around $50,000 in damages")
    # Plain numbers without $-prefix must NOT match.
    assert not fires("Senate Bill 200 was introduced")
    assert not fires("200 million people watched")


def test_media_pack_all_referenced_types_are_canonical():
    """Property-style sanity: every canonical type used as a value anywhere
    in the pack (gliner labels, nuextract map, universalner queries, regex
    patterns) appears in canonical_types. Catches typos like SPEEKER."""
    pack = _load_media_pack()
    universe = set(pack.canonical_types)

    referenced: set[str] = set()
    referenced.update(pack.gliner.labels.values())
    referenced.update(pack.nuextract.canonical_type_map.values())
    referenced.update(pack.universalner.queries.keys())
    referenced.update(pack.regex.patterns.keys())
    referenced.update(pack.regex.authoritative_for)

    missing = referenced - universe
    assert not missing, (
        f"types referenced in pack but missing from canonical_types: "
        f"{sorted(missing)}"
    )
