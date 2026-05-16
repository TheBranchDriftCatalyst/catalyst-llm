"""Tests for the LabelPack loader and bundled packs."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from catalyst_langgraph.label_packs import (
    LabelPack,
    load_generic_label_pack,
    load_label_pack,
)


def test_generic_pack_loads_with_legacy_label_count():
    """generic pack mirrors the old hardcoded MENTION_TYPE_TO_GLINER_LABEL dict (15 labels)."""
    pack = load_generic_label_pack()
    assert pack.name == "generic"
    assert pack.has_gliner_labels()
    assert len(pack.gliner.labels) == 15  # matches legacy map
    # Every gliner label points to a canonical type that's in the universe
    for label, canonical in pack.gliner.labels.items():
        assert canonical in pack.canonical_types, f"{label} → {canonical} not in canonical_types"


def test_generic_pack_universalner_queries_match_legacy_types():
    """generic pack universalner section mirrors legacy MENTION_TYPE_TO_QUERY (10 types)."""
    pack = load_generic_label_pack()
    assert set(pack.universalner.queries.keys()) == {
        "PERSON", "ORG", "GPE", "LOC", "DATE",
        "LAW", "EVENT", "MONEY", "NORP", "FACILITY",
    }
    # assistant_prime must stay verbatim — it's part of UniNER training distribution
    assert pack.universalner.assistant_prime == "I've read this text."


def test_generic_pack_nuextract_template_has_legacy_categories():
    pack = load_generic_label_pack()
    assert set(pack.nuextract.template.keys()) == {
        "Person", "Organization", "Country", "Location",
        "Date", "Law", "Event", "Money", "Group",
    }
    assert pack.nuextract.canonical_type_map["Person"] == "PERSON"
    assert pack.nuextract.canonical_type_map["Group"] == "NORP"


def test_pii_pack_loads_with_regex_patterns():
    pack = load_label_pack(None, "pii")
    assert pack.name == "pii"
    assert "SSN" in pack.gliner.labels.values()
    assert "EMAIL" in pack.regex.patterns
    # Regex section can mark types as authoritative for tie-breaking
    assert "EMAIL" in pack.regex.authoritative_for


def test_load_label_pack_prefers_prompt_dir(tmp_path: Path):
    """Custom pack in prompt_dir overrides bundled pack of the same name."""
    custom = {
        "domain": "test",
        "canonical_types": ["FOO"],
        "gliner": {"labels": {"foo thing": "FOO"}, "threshold": 0.2},
    }
    (tmp_path / "myapp.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "myapp")
    assert pack.gliner.labels == {"foo thing": "FOO"}
    assert pack.gliner.threshold == 0.2


def test_load_label_pack_missing_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_label_pack(tmp_path, "nonexistent")


def test_universalner_queries_coerce_string_to_list(tmp_path: Path):
    """A scalar query gets wrapped in a single-element list."""
    custom = {
        "universalner": {"queries": {"BILL": "bill"}},
    }
    (tmp_path / "tmp.labels.yaml").write_text(yaml.safe_dump(custom))
    pack = load_label_pack(tmp_path, "tmp")
    assert pack.universalner.queries["BILL"] == ["bill"]


def test_congress_pack_loads_if_available():
    """Smoke test the real congress pack from catalyst-data when present."""
    candidate = Path(
        "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
        "k8s/congress-data/prompts/congress.labels.yaml"
    )
    if not candidate.is_file():
        pytest.skip("congress pack not present in this env")
    pack = load_label_pack(candidate.parent, "congress")
    # Sanity: legislative types present
    assert "BILL" in pack.canonical_types
    assert "PUBLIC_LAW" in pack.canonical_types
    assert "COMMITTEE_REF" in pack.canonical_types
    # GLiNER has 20+ descriptive labels (vs generic's 15)
    assert len(pack.gliner.labels) >= 20
    # Regex authoritative on format-validated IDs
    assert "BILL" in pack.regex.authoritative_for
    assert "PUBLIC_LAW" in pack.regex.authoritative_for
    # NuExtract has a nested template (Bill.Sponsor.Name path)
    assert "Bill.Sponsor.Name" in pack.nuextract.canonical_type_map
    # UniNER has multi-probe queries for PERSON
    assert len(pack.universalner.queries.get("PERSON", [])) >= 2
