"""QA-tier tests for AmrParserClient — a non-tautological strength pyramid.

This file complements ``tests/test_amr_parser.py`` (written by the dev).
The dev tests verify the happy paths and the obvious edge cases. THIS
file probes the contract from outside: adversarial inputs, property-based
invariants, differential cross-splitter checks, and one real-bill
scenario.

Layout:
    Tier 1 — Adversarial unit (~60% of new tests)
    Tier 2 — Property-based with hypothesis (~25%)
    Tier 3 — Differential / cross-validation (~10%)
    Tier 4 — Real-world scenario (~5%)

All tests stub amrlib with a local ``_FakeParser`` so the suite runs
green without the 500 MB t5 checkpoint installed.
"""

from __future__ import annotations

import asyncio
import dataclasses
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from catalyst_langgraph.clients.amr_parser import AmrParserClient, AmrSentenceParse


_FIXED_PENMAN = "(p / parse-01\n      :ARG0 (s / stub))"


class _FakeParser:
    """Minimal stand-in for amrlib's ``StogInference``.

    ``fail_on_token``: any sentence containing this token will return
    ``None`` (amrlib's "graph failed" sentinel).
    ``raise_on_token``: any sentence containing this token raises.
    """

    def __init__(
        self,
        *,
        fail_on_token: str | None = None,
        raise_on_token: str | None = None,
    ) -> None:
        self.fail_on_token = fail_on_token
        self.raise_on_token = raise_on_token
        self.calls: list[str] = []

    def parse_sents(self, sentences: list[str]) -> list[str | None]:
        out: list[str | None] = []
        for s in sentences:
            self.calls.append(s)
            if self.raise_on_token is not None and self.raise_on_token in s:
                raise RuntimeError(f"parser exploded on token: {self.raise_on_token}")
            if self.fail_on_token is not None and self.fail_on_token in s:
                out.append(None)
            else:
                out.append(_FIXED_PENMAN)
        return out


def _install(client: AmrParserClient, fake: _FakeParser) -> None:
    """Pin the parser so ``_load_parser`` is a no-op."""

    client._parser = fake
    client._load_parser = lambda: fake  # type: ignore[method-assign]


def _run(coro):
    return asyncio.run(coro)


def _strip_duration(rec: AmrSentenceParse) -> tuple:
    """Equality across runs ignoring timing — ``parse_duration_s`` is
    non-deterministic by design (wall-clock)."""
    return (
        rec.sentence_text,
        rec.sentence_index,
        rec.sentence_char_start,
        rec.sentence_char_end,
        rec.penman,
        rec.parse_error,
    )


# ============================================================================
# Tier 1 — Adversarial unit tests
# ============================================================================


def test_t1_mid_batch_failure_does_not_cascade():
    """100-sentence batch, parser fails on sentence 17.

    Per the sentence-isolation contract: sentences 0..16 must succeed,
    17 must record the parse_error, and 18..99 must still succeed (no
    cascade where a single bad sentence taints later sentences via
    shared parser state).
    """
    # Build a 100-sentence chunk where sentence 17 is uniquely identifiable.
    parts = [f"Sentence number {i} ends here." for i in range(100)]
    # Tag sentence 17 with a token the fake parser will fail on.
    parts[17] = "Sentence number 17 contains the BADTOKEN here."
    text = " ".join(parts)

    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser(fail_on_token="BADTOKEN"))

    results = _run(client.parse(text))

    assert len(results) == 100
    # 0..16: parse_error is None
    for i in range(17):
        assert results[i].parse_error is None, f"sentence {i} unexpectedly failed"
        assert results[i].penman == _FIXED_PENMAN
    # 17: failed, penman empty, error set
    assert results[17].parse_error is not None
    assert results[17].penman == ""
    assert "BADTOKEN" in results[17].sentence_text
    # 18..99: parse_error is None — no cascading failure
    for i in range(18, 100):
        assert results[i].parse_error is None, f"sentence {i} cascaded from 17"
        assert results[i].penman == _FIXED_PENMAN


def test_t1_chunk_starts_with_sentence_terminator():
    """``.Hello world.`` — leading period must not produce negative offsets
    or offsets that exceed len(text). All offsets must be valid slice
    indices on the original text.
    """
    text = ".Hello world."
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    # Whatever the splitter produces, every offset must be a valid slice
    # bound and round-trip onto the original text.
    for r in results:
        assert r.sentence_char_start >= 0, "negative start offset"
        assert r.sentence_char_end <= len(text), "end offset exceeds text length"
        assert r.sentence_char_start <= r.sentence_char_end, "inverted span"
        sliced = text[r.sentence_char_start : r.sentence_char_end]
        # The recorded sentence_text must be findable inside the slice
        # (modulo strip — leading period may or may not be included
        # depending on splitter; we only assert no bogus offsets).
        assert r.sentence_text.strip() in sliced or sliced.strip() == r.sentence_text


def test_t1_unicode_offsets_land_on_codepoint_boundaries():
    """Emoji, CJK, combining diacritics: char offsets must be re-sliceable.

    Python strings are sequences of code points, so any offset in
    ``range(0, len(text)+1)`` is a valid code-point boundary by
    construction; the real invariant to verify is that
    ``text[start:end] == sentence_text`` round-trips even when the
    sentence contains multi-byte UTF-8 characters.
    """
    text = (
        "The café served espresso. "  # 'café' with combining acute
        "\U0001f30d hello world. "  # earth globe emoji
        "שלום ends here."  # Hebrew "shalom" (RTL)
    )

    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    # The regex splitter strips, so each sentence_text must round-trip
    # to the corresponding sliced range.
    for r in results:
        sliced = text[r.sentence_char_start : r.sentence_char_end]
        assert sliced == r.sentence_text, (
            f"Unicode offset slice mismatch: {sliced!r} vs {r.sentence_text!r}"
        )


def test_t1_max_chars_fragments_share_sentence_index():
    """A 47-char sentence at cap=10 must produce fragments that:
      (a) are contiguous (no gaps, no overlap),
      (b) re-concatenate to the original sentence,
      (c) all share the SAME sentence_index — they are chops of one
          sentence, not new sentences.
    """
    sentence = "x" * 47
    client = AmrParserClient(sentence_splitter="regex", max_sentence_chars=10)
    _install(client, _FakeParser())

    results = _run(client.parse(sentence))

    # Five fragments: 10, 10, 10, 10, 7.
    assert len(results) == 5
    # (a) contiguous
    for prev, nxt in zip(results, results[1:]):
        assert prev.sentence_char_end == nxt.sentence_char_start
    assert results[0].sentence_char_start == 0
    assert results[-1].sentence_char_end == 47
    # (b) reconstructs
    assert "".join(r.sentence_text for r in results) == sentence
    # (c) all fragments carry the same sentence_index (this is the
    # contract violation the QA pyramid is testing).
    assert {r.sentence_index for r in results} == {0}


def test_t1_chunk_of_only_whitespace_and_punctuation_no_crash():
    """Pure whitespace returns []. Pure-punctuation chunks must not
    crash — they may produce 0 or N records, but no exceptions.
    """
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    # Pure whitespace family: must be empty.
    for ws in ["", "   ", "\n\n", "\t \r ", "  \n\t  "]:
        assert _run(client.parse(ws)) == [], f"expected [] for {ws!r}"

    # Punctuation-only — may yield records but must not crash, and any
    # records returned must satisfy the round-trip invariant.
    for punct in [".", "...", "!!!", "?!", ". ! ?"]:
        results = _run(client.parse(punct))
        for r in results:
            sliced = punct[r.sentence_char_start : r.sentence_char_end]
            assert sliced == r.sentence_text


def test_t1_mixed_line_endings_preserve_offsets():
    """CRLF, LF, CR mixed inside a chunk. Offsets are byte/codepoint
    indices into the original chunk — they MUST reflect the raw text
    (no implicit normalization).
    """
    text = "First sentence.\r\nSecond sentence.\nThird sentence.\rFourth sentence."
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    for r in results:
        sliced = text[r.sentence_char_start : r.sentence_char_end]
        assert sliced == r.sentence_text, (
            f"line-ending normalization broke offsets: {sliced!r} vs {r.sentence_text!r}"
        )


def test_t1_parse_is_idempotent_ignoring_duration():
    """Calling parse() twice on the same client + same input must yield
    identical results (modulo wall-clock-derived ``parse_duration_s``).

    No accumulating state, no shared mutable caches.
    """
    text = (
        "Senator Smith introduced the bill. "
        "The bill was referred to committee. "
        "It passed on a voice vote."
    )
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    r1 = _run(client.parse(text))
    r2 = _run(client.parse(text))
    assert len(r1) == len(r2)
    for a, b in zip(r1, r2):
        assert _strip_duration(a) == _strip_duration(b)


def test_t1_invalid_splitter_arg_raises_value_error_with_helpful_message():
    """Constructor must reject unknown splitters with a message that
    lists the valid choices."""
    with pytest.raises(ValueError) as exc_info:
        AmrParserClient(sentence_splitter="markov")
    msg = str(exc_info.value)
    # The message must enumerate the valid options so the caller can fix
    # their config without reading the source.
    assert "spacy" in msg
    assert "regex" in msg
    assert "blanks" in msg
    assert "markov" in msg, "error message should echo the bad value"


def test_t1_negative_max_chars_rejected():
    """Cap of 0 or negative is rejected. The constructor must not allow
    a state where chopping would loop forever."""
    with pytest.raises(ValueError):
        AmrParserClient(max_sentence_chars=-1)
    with pytest.raises(ValueError):
        AmrParserClient(max_sentence_chars=0)


def test_t1_blanks_splitter_with_duplicate_paragraphs_picks_distinct_occurrences():
    """``_split_with_blanks`` uses ``text.find(piece, cursor)`` — if the
    cursor isn't advanced correctly, duplicate paragraphs would all
    map to the FIRST occurrence (or worse, the wrong one). Verify
    each paragraph maps to its own distinct offset range.
    """
    text = "same\n\nsame\n\nsame"
    client = AmrParserClient(sentence_splitter="blanks")
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    assert len(results) == 3
    # All three must have distinct, non-overlapping spans.
    starts = [r.sentence_char_start for r in results]
    assert starts == sorted(starts)
    assert len(set(starts)) == 3, "duplicates collapsed to same offset"
    for r in results:
        assert text[r.sentence_char_start : r.sentence_char_end] == r.sentence_text


def test_t1_duplicate_sentences_in_regex_splitter_get_distinct_offsets():
    """Same as above but for the regex splitter — duplicate-detection
    via ``text.find(piece, cursor)`` must use the cursor."""
    text = "Hello. Hello. Hello."
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    assert len(results) == 3
    starts = [r.sentence_char_start for r in results]
    assert len(set(starts)) == 3, "duplicate sentences collapsed to one offset"
    assert starts == sorted(starts)


def test_t1_dataclass_is_frozen_at_assignment_time():
    """The dev's frozen test catches assignment after construction. Also
    verify dataclasses.replace() works (the canonical way to update a
    frozen record without mutation)."""
    rec = AmrSentenceParse(
        sentence_text="a",
        sentence_index=0,
        sentence_char_start=0,
        sentence_char_end=1,
        penman="(a / a)",
        parse_duration_s=0.0,
        parse_error=None,
    )
    new = dataclasses.replace(rec, sentence_text="b")
    assert new.sentence_text == "b"
    assert rec.sentence_text == "a", "original mutated by replace()"


def test_t1_failure_record_has_empty_penman_not_none():
    """Contract: ``penman`` is ``""`` (empty string) iff ``parse_error``
    is set. NOT ``None``. Downstream consumers expect string semantics."""
    text = "First sentence. BADTOKEN sentence. Third sentence."
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser(fail_on_token="BADTOKEN"))

    results = _run(client.parse(text))

    failed = [r for r in results if r.parse_error is not None]
    assert len(failed) == 1
    assert failed[0].penman == ""
    assert isinstance(failed[0].penman, str)
    assert failed[0].penman is not None


def test_t1_parse_error_format_is_exc_type_colon_message():
    """Contract from interface: ``parse_error`` format is ``"<ExcType>: <msg>"``."""
    text = "Good sentence. BOOM bad sentence."
    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser(raise_on_token="BOOM"))

    results = _run(client.parse(text))

    failed = next(r for r in results if r.parse_error is not None)
    assert failed.parse_error.startswith("RuntimeError: ")
    assert "exploded" in failed.parse_error


def test_t1_max_chars_one_yields_one_record_per_character():
    """Pathological cap=1 on a 5-char sentence must produce 5 fragments,
    each one character, all sharing the same sentence_index.

    Catches infinite-loop / off-by-one bugs in ``_enforce_max_chars``.
    """
    text = "abcde"
    client = AmrParserClient(sentence_splitter="regex", max_sentence_chars=1)
    _install(client, _FakeParser())

    results = _run(client.parse(text))

    assert len(results) == 5
    assert "".join(r.sentence_text for r in results) == text
    assert {r.sentence_index for r in results} == {0}
    # And each carries the right offset.
    for i, r in enumerate(results):
        assert r.sentence_char_start == i
        assert r.sentence_char_end == i + 1


# ============================================================================
# Tier 2 — Property-based invariants
# ============================================================================


# Hypothesis text strategies. Mix ASCII + Unicode; cap sizes so a single
# example doesn't dominate the budget.
_TEXT_STRATEGY = st.text(
    alphabet=st.characters(
        codec="utf-8",
        # Exclude surrogates and other unencodable chars to keep slice
        # round-trips well-defined.
        categories=("Lu", "Ll", "Nd", "Po", "Zs", "So", "Lo"),
    ),
    min_size=0,
    max_size=200,
)

_SPLITTER_STRATEGY = st.sampled_from(["regex", "blanks"])


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_total_text_never_exceeds_input_length(chunk: str, splitter: str):
    """Invariant: ``sum(len(p.sentence_text) for p in results) <=
    len(chunk)``. Whitespace is dropped by stripping, but the splitter
    must never duplicate or fabricate text."""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    total = sum(len(r.sentence_text) for r in results)
    assert total <= len(chunk), (
        f"text inflation: results sum {total} > input {len(chunk)} (splitter={splitter})"
    )


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_offsets_are_well_formed(chunk: str, splitter: str):
    """Invariant: for every result, 0 <= start <= end <= len(chunk)."""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    for r in results:
        assert r.sentence_char_start >= 0
        assert r.sentence_char_start <= r.sentence_char_end
        assert r.sentence_char_end <= len(chunk)


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_offsets_non_decreasing_with_index(chunk: str, splitter: str):
    """Invariant: when sorted by sentence_index, char_start must be
    non-decreasing. (The splitter must preserve document order.)"""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    # Use the order the parser returned them in.
    starts = [r.sentence_char_start for r in results]
    assert starts == sorted(starts), (
        f"out-of-order char_starts: {starts} (splitter={splitter})"
    )


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_slice_contains_sentence_text(chunk: str, splitter: str):
    """Invariant: ``chunk[start:end]`` contains ``sentence_text`` (after
    stripping). The splitter records offsets that map onto the original
    text exactly."""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    for r in results:
        sliced = chunk[r.sentence_char_start : r.sentence_char_end]
        assert r.sentence_text in sliced or sliced.strip() == r.sentence_text, (
            f"sentence_text {r.sentence_text!r} not found in slice {sliced!r}"
        )


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_parse_duration_non_negative(chunk: str, splitter: str):
    """Invariant: parse_duration_s >= 0 always. (Clock skew or
    monotonic-clock bugs could theoretically yield negatives.)"""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    for r in results:
        assert r.parse_duration_s >= 0.0


@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(chunk=_TEXT_STRATEGY, splitter=_SPLITTER_STRATEGY)
def test_t2_sentence_index_starts_at_zero_and_is_dense(chunk: str, splitter: str):
    """Invariant: sentence_index values, deduplicated, form a contiguous
    range starting at 0. (Fragments share an index, so dedup is
    required; but the *unique* indices must be 0, 1, 2, ... no gaps.)"""
    client = AmrParserClient(sentence_splitter=splitter)
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))
    if not results:
        return
    unique = sorted({r.sentence_index for r in results})
    assert unique == list(range(len(unique))), (
        f"sentence_index has gaps: {unique}"
    )


# ============================================================================
# Tier 3 — Differential / cross-validation
# ============================================================================


def test_t3_regex_and_blanks_splitters_both_self_consistent_on_same_input():
    """The two splitters MAY produce different sentence counts (regex
    splits on ``.!?``, blanks on paragraph breaks). But each must
    independently satisfy: sum(end-start) <= len(chunk)."""
    text = (
        "First paragraph sentence one. First paragraph sentence two.\n\n"
        "Second paragraph sentence one. Second paragraph sentence two."
    )
    client_regex = AmrParserClient(sentence_splitter="regex")
    client_blanks = AmrParserClient(sentence_splitter="blanks")
    _install(client_regex, _FakeParser())
    _install(client_blanks, _FakeParser())

    r_regex = _run(client_regex.parse(text))
    r_blanks = _run(client_blanks.parse(text))

    # Each splitter independently satisfies coverage <= len(text).
    cov_regex = sum(r.sentence_char_end - r.sentence_char_start for r in r_regex)
    cov_blanks = sum(r.sentence_char_end - r.sentence_char_start for r in r_blanks)
    assert cov_regex <= len(text)
    assert cov_blanks <= len(text)

    # Counts differ — that's the point of having two splitters.
    assert len(r_regex) >= len(r_blanks), (
        "regex should find at least as many sentences as blanks "
        "(blanks splits only on paragraph breaks)"
    )

    # Each result still round-trips.
    for r in r_regex:
        sliced = text[r.sentence_char_start : r.sentence_char_end]
        assert sliced == r.sentence_text
    for r in r_blanks:
        sliced = text[r.sentence_char_start : r.sentence_char_end]
        assert sliced == r.sentence_text


def test_t3_concurrent_gather_returns_deeply_equal_results():
    """asyncio.gather two parses of the same chunk. Results must match
    on every field except parse_duration_s (timing). No shared mutable
    state between calls."""

    async def driver():
        client = AmrParserClient(sentence_splitter="regex")
        _install(client, _FakeParser())
        text = "Alpha sentence one. Beta sentence two. Gamma sentence three."
        a, b = await asyncio.gather(client.parse(text), client.parse(text))
        return a, b

    a, b = asyncio.run(driver())
    assert len(a) == len(b) == 3
    for x, y in zip(a, b):
        assert _strip_duration(x) == _strip_duration(y), (
            "concurrent parses diverged — shared mutable state suspected"
        )


# ============================================================================
# Tier 4 — Real-world scenario
# ============================================================================


def test_t4_bills_section_of_how_our_laws_are_made():
    """Parse the BILLS section of how-our-laws-are-made.md (lines 295-315).

    With the stub parser (fixed PENMAN for every sentence), the only
    things that can go wrong are splitter quirks or offset bugs.
    Asserts: >=3 sentences, every offset round-trips, no parse_error.
    """
    md_path = Path(
        "/Users/panda/catalyst-devspace/workspace/catalyst-llm/"
        "packages/catalyst-exgraph/docs/reseearch/congress/"
        "how-our-laws-are-made.md"
    )
    raw = md_path.read_text(encoding="utf-8").splitlines()
    chunk = "\n".join(raw[294:315])  # lines 295-315 inclusive, 0-indexed

    client = AmrParserClient(sentence_splitter="regex")
    _install(client, _FakeParser())

    results = _run(client.parse(chunk))

    assert len(results) >= 3, f"expected >=3 sentences, got {len(results)}"
    for r in results:
        # Every offset must land inside the chunk.
        assert 0 <= r.sentence_char_start <= r.sentence_char_end <= len(chunk)
        sliced = chunk[r.sentence_char_start : r.sentence_char_end]
        assert sliced == r.sentence_text, (
            f"offset round-trip failed on real bill text: "
            f"{sliced!r} vs {r.sentence_text!r}"
        )
        # Stub returns fixed PENMAN for all sentences — if anything
        # failed, that's a splitter or offset bug, not a parser bug.
        assert r.parse_error is None, (
            f"unexpected parse_error on bill text sentence "
            f"{r.sentence_index}: {r.parse_error}"
        )
        assert r.penman == _FIXED_PENMAN
