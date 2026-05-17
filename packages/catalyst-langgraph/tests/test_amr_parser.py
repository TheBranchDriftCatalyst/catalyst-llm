"""Tests for AmrParserClient.

The real amrlib parser is heavy (~500 MB t5 checkpoint) and not installed
in the test environment. Every test that needs a parser stubs
``_load_parser`` with a fake that returns canned PENMAN — this verifies
the slicing, offset bookkeeping, error isolation, and async interface
without ever importing amrlib.
"""

from __future__ import annotations

import asyncio
import builtins
import sys

import pytest

from catalyst_langgraph.clients.amr_parser import AmrParserClient, AmrSentenceParse


_FIXED_PENMAN = "(p / parse-01\n      :ARG0 (s / stub))"


class _FakeParser:
    """Mimics the slice of amrlib's StogInference we actually use."""

    def __init__(self, *, fail_on: set[str] | None = None) -> None:
        self.fail_on = fail_on or set()
        self.calls: list[str] = []

    def parse_sents(self, sentences: list[str]) -> list[str | None]:
        out: list[str | None] = []
        for s in sentences:
            self.calls.append(s)
            if any(token in s for token in self.fail_on):
                # amrlib's failure modes are varied — we exercise the
                # "graph is None" path here and the "raises" path in
                # another test via a side_effect parser.
                out.append(None)
            else:
                out.append(_FIXED_PENMAN)
        return out


def _install_fake_parser(client: AmrParserClient, fake: _FakeParser) -> None:
    """Bypass amrlib entirely by pinning ``_parser`` and short-circuiting
    ``_load_parser``."""

    client._parser = fake
    client._load_parser = lambda: fake  # type: ignore[method-assign]


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Basic shape
# ---------------------------------------------------------------------------


def test_dataclass_is_frozen_and_field_set_is_stable():
    """The interface contract for subagent C — fields must not drift."""
    rec = AmrSentenceParse(
        sentence_text="Hi.",
        sentence_index=0,
        sentence_char_start=0,
        sentence_char_end=3,
        penman="(h / hi)",
        parse_duration_s=0.001,
        parse_error=None,
    )
    with pytest.raises(Exception):
        rec.sentence_text = "mutated"  # type: ignore[misc]
    expected_fields = {
        "sentence_text",
        "sentence_index",
        "sentence_char_start",
        "sentence_char_end",
        "penman",
        "parse_duration_s",
        "parse_error",
    }
    assert set(rec.__dataclass_fields__.keys()) == expected_fields


def test_constructor_rejects_bad_splitter_and_cap():
    with pytest.raises(ValueError):
        AmrParserClient(sentence_splitter="nope")
    with pytest.raises(ValueError):
        AmrParserClient(max_sentence_chars=0)


# ---------------------------------------------------------------------------
# Three-sentence congress chunk → 3 records with correct char offsets
# ---------------------------------------------------------------------------


def test_parse_three_sentences_emits_three_records_with_offsets():
    # NOTE: avoid abbreviation periods ("H.R.") in regex-mode inputs — the
    # bare regex splitter treats every "." + whitespace as a boundary by
    # design (use spaCy in production for abbreviation-aware splitting).
    text = (
        "Senator Smith introduced the bill on Monday. "
        "The bill was referred to the Committee on Energy. "
        "It passed on a voice vote."
    )
    client = AmrParserClient(sentence_splitter="regex")
    _install_fake_parser(client, _FakeParser())

    results = _run(client.parse(text))

    assert len(results) == 3
    # Offsets must round-trip — slicing the original text by each record's
    # span must produce exactly the recorded sentence_text.
    for rec in results:
        assert text[rec.sentence_char_start : rec.sentence_char_end] == rec.sentence_text
        assert rec.penman == _FIXED_PENMAN
        assert rec.parse_error is None
        assert rec.parse_duration_s >= 0.0
    # Indices are 0-based and contiguous.
    assert [r.sentence_index for r in results] == [0, 1, 2]
    # Spans are non-overlapping and monotonically increasing.
    assert results[0].sentence_char_end <= results[1].sentence_char_start
    assert results[1].sentence_char_end <= results[2].sentence_char_start


# ---------------------------------------------------------------------------
# Per-sentence error isolation
# ---------------------------------------------------------------------------


def test_one_failing_sentence_does_not_kill_the_chunk():
    text = (
        "Senator Smith introduced the bill on Monday. "
        "BAD_SENTENCE blows up the parser. "
        "It passed on a voice vote."
    )
    client = AmrParserClient(sentence_splitter="regex")
    _install_fake_parser(client, _FakeParser(fail_on={"BAD_SENTENCE"}))

    results = _run(client.parse(text))

    assert len(results) == 3
    assert results[0].parse_error is None and results[0].penman == _FIXED_PENMAN
    assert results[1].parse_error is not None
    assert results[1].penman == ""
    assert "BAD_SENTENCE" in results[1].sentence_text
    assert results[2].parse_error is None and results[2].penman == _FIXED_PENMAN


def test_exception_from_parser_is_caught_per_sentence():
    """amrlib can raise — not just return None. Same isolation must apply."""

    class _ExplodingParser:
        def parse_sents(self, sentences: list[str]) -> list[str]:
            if "BOOM" in sentences[0]:
                raise RuntimeError("cuda oom")
            return [_FIXED_PENMAN for _ in sentences]

    text = "First sentence ok. Second sentence BOOM. Third sentence ok."
    client = AmrParserClient(sentence_splitter="regex")
    _install_fake_parser(client, _ExplodingParser())  # type: ignore[arg-type]

    results = _run(client.parse(text))
    assert len(results) == 3
    assert results[0].parse_error is None
    assert results[1].parse_error is not None and "cuda oom" in results[1].parse_error
    assert results[2].parse_error is None


# ---------------------------------------------------------------------------
# Sentence splitter regex fallback when spaCy isn't installed
# ---------------------------------------------------------------------------


def test_regex_fallback_when_spacy_missing(monkeypatch):
    """sentence_splitter='spacy' but spaCy import fails → regex behaviour."""

    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "spacy" or name.startswith("spacy."):
            raise ImportError("simulated missing spacy")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    # Also evict any cached spacy module so the import path actually runs.
    for mod in list(sys.modules):
        if mod == "spacy" or mod.startswith("spacy."):
            monkeypatch.delitem(sys.modules, mod, raising=False)

    client = AmrParserClient(sentence_splitter="spacy")
    _install_fake_parser(client, _FakeParser())

    text = "One sentence here. Two sentences here. Three sentences here."
    results = _run(client.parse(text))

    assert len(results) == 3
    # And the spaCy-attempted flag is set so we don't keep retrying.
    assert client._spacy_attempted is True
    assert client._spacy_nlp is None


# ---------------------------------------------------------------------------
# Async interface
# ---------------------------------------------------------------------------


def test_parse_returns_awaitable():
    """The signature is async — the result of parse() must be a coroutine."""

    client = AmrParserClient(sentence_splitter="regex")
    _install_fake_parser(client, _FakeParser())

    coro = client.parse("Hello world.")
    assert asyncio.iscoroutine(coro)
    results = asyncio.run(coro)
    assert isinstance(results, list)
    assert all(isinstance(r, AmrSentenceParse) for r in results)


def test_parse_under_existing_event_loop_via_to_thread():
    """Sanity: parser runs through asyncio.to_thread without blocking."""

    async def driver() -> list[AmrSentenceParse]:
        client = AmrParserClient(sentence_splitter="regex")
        _install_fake_parser(client, _FakeParser())
        # Kick off two parses concurrently to ensure no shared-state surprise.
        a, b = await asyncio.gather(
            client.parse("Alpha sentence."),
            client.parse("Bravo sentence."),
        )
        return a + b

    out = asyncio.run(driver())
    assert len(out) == 2
    assert all(r.penman == _FIXED_PENMAN for r in out)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_empty_input_returns_empty_list():
    client = AmrParserClient(sentence_splitter="regex")
    _install_fake_parser(client, _FakeParser())
    assert _run(client.parse("")) == []
    assert _run(client.parse("   \n  ")) == []


def test_max_sentence_chars_chops_long_sentence():
    """A 5000-char "sentence" with cap=200 yields 25 fragments with
    contiguous offsets that round-trip against the original text."""
    text = "x" * 5000
    client = AmrParserClient(sentence_splitter="regex", max_sentence_chars=200)
    _install_fake_parser(client, _FakeParser())

    results = _run(client.parse(text))
    assert len(results) == 25
    # Fragments cover the whole text exactly once, in order, no gaps/overlap.
    assert results[0].sentence_char_start == 0
    assert results[-1].sentence_char_end == 5000
    for prev, nxt in zip(results, results[1:]):
        assert prev.sentence_char_end == nxt.sentence_char_start
    # Round-trip: rejoining fragments reconstructs the input.
    rejoined = "".join(r.sentence_text for r in results)
    assert rejoined == text


def test_missing_amrlib_raises_import_error_with_install_hint():
    """When amrlib isn't installed and we haven't stubbed _parser, parse()
    raises ImportError with a clear pip-install message."""

    client = AmrParserClient(sentence_splitter="regex")
    # Force the real lazy-load path. Patch builtins.__import__ to refuse amrlib.
    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "amrlib" or name.startswith("amrlib."):
            raise ImportError("no amrlib")
        return real_import(name, globals, locals, fromlist, level)

    saved = builtins.__import__
    builtins.__import__ = fake_import  # type: ignore[assignment]
    try:
        with pytest.raises(ImportError) as exc_info:
            _run(client.parse("Hello world."))
    finally:
        builtins.__import__ = saved  # type: ignore[assignment]

    msg = str(exc_info.value)
    assert "amrlib" in msg
    assert "pip install" in msg
