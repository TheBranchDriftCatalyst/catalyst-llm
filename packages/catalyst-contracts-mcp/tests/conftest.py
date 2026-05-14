"""Shared test fixtures for catalyst-contracts-mcp.

source_text + valid/invalid mention+proposition data — the MCP server
tests exercise the same validators as catalyst-exgraph's
test_validators suite, so the fixture set is identical. Kept here
rather than reaching across packages to keep this package's test
suite hermetic.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SOURCE_TEXT = (FIXTURES_DIR / "sample_source_text.txt").read_text()


@pytest.fixture
def source_text() -> str:
    return SOURCE_TEXT


@pytest.fixture
def valid_mentions_data() -> list[dict]:
    return json.loads((FIXTURES_DIR / "valid_mentions.json").read_text())


@pytest.fixture
def invalid_mentions_data() -> list[dict]:
    return json.loads((FIXTURES_DIR / "invalid_mentions.json").read_text())


@pytest.fixture
def valid_propositions_data() -> list[dict]:
    return json.loads((FIXTURES_DIR / "valid_propositions.json").read_text())


@pytest.fixture
def invalid_propositions_data() -> list[dict]:
    return json.loads((FIXTURES_DIR / "invalid_propositions.json").read_text())
