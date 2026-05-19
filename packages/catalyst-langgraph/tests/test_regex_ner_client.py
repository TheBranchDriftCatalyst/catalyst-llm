"""Tests for the RegexNerClient (deterministic 4th NER voter)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage, SystemMessage

from catalyst_exgraph.models.extraction_output import MentionExtractionResult
from catalyst_langgraph.clients.regex_ner import RegexNerClient
from catalyst_langgraph.label_packs import load_label_pack


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def _make_pack(tmp_path: Path, patterns: dict, authoritative: list[str] | None = None):
    raw = {
        "domain": "test",
        "regex": {"patterns": patterns, "authoritative_for": authoritative or []},
    }
    (tmp_path / "rx.labels.yaml").write_text(yaml.safe_dump(raw))
    return load_label_pack(tmp_path, "rx")


def test_extracts_bill_and_public_law_with_confidence_1(tmp_path: Path):
    pack = _make_pack(
        tmp_path,
        patterns={
            "BILL": [r"\b(?:H\.R\.|S\.)\s?\d+\b"],
            "PUBLIC_LAW": [r"\bP\.L\.\s?\d+-\d+\b"],
        },
        authoritative=["BILL", "PUBLIC_LAW"],
    )
    client = RegexNerClient(label_pack=pack)
    text = "Rep. Smith introduced H.R. 1234; it became P.L. 119-1 on signing."
    result = _run(
        client.structured_output(
            MentionExtractionResult,
            [SystemMessage(content="ignored"), HumanMessage(content=text)],
        )
    )
    by_type = {m.mention_type: m for m in result.mentions}
    assert "BILL" in by_type and by_type["BILL"].text == "H.R. 1234"
    assert "PUBLIC_LAW" in by_type and by_type["PUBLIC_LAW"].text == "P.L. 119-1"
    assert all(m.confidence == 1.0 for m in result.mentions)


def test_invalid_pattern_skipped_not_raised(tmp_path: Path):
    """A single bad regex shouldn't blow up the voter."""
    pack = _make_pack(
        tmp_path,
        patterns={
            "BAD": [r"["],  # unterminated character class
            "GOOD": [r"\bfoo\b"],
        },
    )
    client = RegexNerClient(label_pack=pack)
    result = _run(
        client.structured_output(
            MentionExtractionResult,
            [HumanMessage(content="hello foo world")],
        )
    )
    assert len(result.mentions) == 1
    assert result.mentions[0].mention_type == "GOOD"


def test_authoritative_for(tmp_path: Path):
    pack = _make_pack(
        tmp_path,
        patterns={"BILL": [r"\bH\.R\.\s?\d+\b"]},
        authoritative=["BILL"],
    )
    client = RegexNerClient(label_pack=pack)
    assert client.is_authoritative_for("BILL") is True
    assert client.is_authoritative_for("PERSON") is False


def test_dedupes_overlapping_pattern_matches(tmp_path: Path):
    """Two patterns hitting the same (start, end, type) only emit one mention."""
    pack = _make_pack(
        tmp_path,
        patterns={
            "BILL": [r"\bH\.R\.\s?\d+\b", r"\bH\.R\.\s?\d+"],  # second is a superset
        },
    )
    client = RegexNerClient(label_pack=pack)
    result = _run(
        client.structured_output(
            MentionExtractionResult,
            [HumanMessage(content="H.R. 1234 and H.R. 1234")],
        )
    )
    # Two distinct occurrences in text → 2 mentions (one per occurrence).
    assert len(result.mentions) == 2
    assert all(m.text == "H.R. 1234" for m in result.mentions)
