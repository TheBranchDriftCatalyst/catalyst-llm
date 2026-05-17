"""AMR parser client — wraps amrlib (default) and emits PENMAN-encoded AMR
graphs per sentence.

AMR (Abstract Meaning Representation) is the semantic spine of the new
extraction pipeline; downstream nodes project AMR variables into SPO
assertions instead of asking an LLM to invent them. This client is the
input boundary: chunk text in, list[AmrSentenceParse] out (one record per
sentence, with char offsets so the downstream projector can attach span
provenance).

Unlike the NER clients (gliner / nuextract / universalner / regex_ner)
this does NOT implement ``structured_output()``. The pipeline node that
consumes it is ``AmrToAssertionNode`` (catalyst-exgraph), not the
existing ``ExtractNode``.

Install path (optional extra; the parser checkpoint is ~500 MB):

    pip install 'catalyst-langgraph[amr]'

or, in this monorepo:

    uv pip install amrlib

The constructor never tries to import amrlib. The import is deferred to
the first ``parse()`` call. If amrlib is missing, ``parse()`` raises
``ImportError`` with the install command above.

Sentence-isolation contract: each sentence is parsed independently and
any parse error is captured on that record's ``parse_error`` field
(``penman`` set to ``""``). One bad sentence never kills the chunk —
this matters for congressional bill text where a single multi-page
"whereas" clause can choke the parser while the rest of the chunk is
fine.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# Regex fallback for sentence splitting when spaCy isn't available.
# Splits on ``.`` ``!`` ``?`` followed by whitespace. Not perfect on
# abbreviations ("H.R. 1234.") but good enough as a degraded mode; the
# spaCy path is preferred and handled separately.
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class AmrSentenceParse:
    """One parsed sentence from an input chunk.

    The (sentence_char_start, sentence_char_end) pair is the half-open
    offset of this sentence's surface form inside the *original chunk
    text* (not the trimmed sentence). Downstream projection uses these
    to map AMR variables back to character spans for provenance.

    ``penman`` is empty when ``parse_error`` is set.

    Equality semantics:
      ``parse_duration_s`` is excluded from ``__eq__`` / ``__hash__`` via
      ``field(compare=False)``. It's wall-clock-derived and would make two
      identical parses non-equal — which breaks deterministic-extraction
      tests and round-trip dedup. The duration is preserved for telemetry;
      compare-by-content stays clean.
    """

    sentence_text: str
    sentence_index: int
    sentence_char_start: int
    sentence_char_end: int
    penman: str
    parse_duration_s: float = field(compare=False)
    parse_error: str | None = None


class AmrParserClient:
    """Wraps an AMR parser (amrlib by default) behind an async interface.

    The parser model is lazy-loaded on the first ``parse()`` call. The
    constructor only stores config so it's cheap to instantiate at
    module import time without pulling in 500 MB of model weights.

    Args:
        model_name: amrlib pretrained checkpoint id (or local path).
            Defaults to the bundled ``amrlib/parse_t5`` t5-based
            checkpoint.
        device: torch device string — ``"cpu"``, ``"cuda"``, or ``"mps"``
            on Apple Silicon. Passed through to amrlib's loader.
        sentence_splitter: ``"spacy"`` (preferred), ``"regex"`` (fallback),
            or ``"blanks"`` (split on blank lines only — useful when the
            upstream chunker has already enforced one sentence per line).

            **Regex caveat**: the regex splitter splits on ``[.!?]\\s+``
            and cannot detect abbreviation periods. Inputs with
            congressional abbreviations (``H.R.``, ``S.``, ``P.L.``,
            ``U.S.C.``, ``Sen.``, ``Dr.``) or initials (``J.F.K.``) will
            over-segment, producing fragments where each abbreviation
            period looks like a sentence boundary. Char offsets are
            still self-consistent on every fragment, but downstream
            consumers may see one logical sentence split into 3–5
            records. Use ``"spacy"`` for any production path that sees
            real bill text, transcripts, or news. ``"regex"`` exists
            only as a degraded fallback when spaCy is unavailable.
        max_sentence_chars: hard cap; sentences longer than this are
            chopped at the cap. Prevents one runaway "whereas" clause
            from blocking the whole chunk on parser memory.
    """

    def __init__(
        self,
        *,
        model_name: str = "amrlib/parse_t5",
        device: str = "cpu",
        sentence_splitter: str = "spacy",
        max_sentence_chars: int = 2000,
    ) -> None:
        if sentence_splitter not in {"spacy", "regex", "blanks"}:
            raise ValueError(
                f"sentence_splitter must be one of spacy/regex/blanks, got {sentence_splitter!r}"
            )
        if max_sentence_chars <= 0:
            raise ValueError(f"max_sentence_chars must be > 0, got {max_sentence_chars}")
        self.model_name = model_name
        self.device = device
        self.sentence_splitter = sentence_splitter
        self.max_sentence_chars = max_sentence_chars

        self._parser: Any = None
        # spaCy nlp pipeline, populated on first use when splitter == "spacy".
        # When spaCy import fails we silently fall back to regex and remember
        # that decision so we don't keep retrying the import per call.
        self._spacy_nlp: Any = None
        self._spacy_attempted: bool = False

    def _load_parser(self) -> Any:
        """Import amrlib lazily and load the parse model.

        Separated into its own method so tests can monkeypatch it with a
        fake parser without needing amrlib installed. Returns an object
        with a ``parse_sents(list[str]) -> list[str]`` method matching
        amrlib's ``StogInference`` interface.
        """
        if self._parser is not None:
            return self._parser
        try:
            import amrlib  # type: ignore[import-not-found]
        except ImportError as exc:
            raise ImportError(
                "amrlib is not installed. Install with: pip install 'catalyst-langgraph[amr]' "
                "(or `uv pip install amrlib`). See module docstring for details."
            ) from exc

        logger.info("amr-parser: loading %s on %s", self.model_name, self.device)
        t0 = time.perf_counter()
        # amrlib's loader picks a checkpoint dir; passing model_dir lets
        # callers point at a local copy when they've cached one.
        self._parser = amrlib.load_stog_model(model_name=self.model_name, device=self.device)
        logger.info("amr-parser: model loaded in %.1fs", time.perf_counter() - t0)
        return self._parser

    def _split_sentences(self, text: str) -> list[tuple[str, int, int, int]]:
        """Split ``text`` into ``(sentence_text, char_start, char_end, sentence_index)`` tuples.

        ``char_start`` / ``char_end`` are offsets in the *original* text
        (half-open), so the caller can slice ``text[start:end]`` and get
        back the same surface form as ``sentence_text``.

        ``sentence_index`` is the 0-based index of the sentence in the
        original chunk. When ``max_sentence_chars`` chops a long sentence
        into multiple fragments, every fragment shares the same
        ``sentence_index`` — they're chops of the same sentence, not new
        sentences.

        Strategy:
          * ``spacy``: use spaCy if it imports + a model loads; otherwise
            fall back to regex on first failure (and remember).
          * ``regex``: split on ``[.!?]\\s+`` and walk offsets.
          * ``blanks``: split on blank lines (``\\n\\s*\\n``).

        Empty / whitespace-only sentences are dropped. Sentences exceeding
        ``max_sentence_chars`` are chopped into back-to-back fragments so
        the parser never sees more than the cap per call.
        """
        if not text.strip():
            return []

        if self.sentence_splitter == "spacy":
            triples = self._split_with_spacy(text)
            if triples is None:
                # spaCy unavailable — degrade to regex without reconfiguring.
                triples = self._split_with_regex(text)
        elif self.sentence_splitter == "regex":
            triples = self._split_with_regex(text)
        else:
            triples = self._split_with_blanks(text)

        return self._enforce_max_chars(triples)

    def _split_with_spacy(self, text: str) -> list[tuple[str, int, int]] | None:
        """Try spaCy; return None if it can't be loaded (caller falls back)."""
        if self._spacy_attempted and self._spacy_nlp is None:
            return None
        if not self._spacy_attempted:
            self._spacy_attempted = True
            try:
                import spacy  # type: ignore[import-not-found]
            except ImportError:
                logger.info("amr-parser: spaCy not installed; falling back to regex splitter")
                return None
            # Prefer a small English model; fall back to a blank pipeline
            # with the sentencizer component when no model is available.
            try:
                self._spacy_nlp = spacy.load("en_core_web_sm", disable=["ner", "tagger", "lemmatizer"])
            except (OSError, IOError):
                self._spacy_nlp = spacy.blank("en")
                self._spacy_nlp.add_pipe("sentencizer")

        doc = self._spacy_nlp(text)
        out: list[tuple[str, int, int]] = []
        for sent in doc.sents:
            s = sent.text.strip()
            if not s:
                continue
            # sent.start_char / sent.end_char are offsets in the original
            # text — exactly what the projection layer wants.
            out.append((s, sent.start_char, sent.end_char))
        return out

    def _split_with_regex(self, text: str) -> list[tuple[str, int, int]]:
        out: list[tuple[str, int, int]] = []
        cursor = 0
        for piece in _SENTENCE_BOUNDARY_RE.split(text):
            if not piece:
                # Keep the cursor advanced past the separator.
                # split() with a lookbehind separator never returns the
                # separator itself, so locate the next non-whitespace.
                continue
            # Find this piece in text starting from cursor; this preserves
            # the original whitespace runs that the regex split consumed.
            idx = text.find(piece, cursor)
            if idx < 0:
                # Should be unreachable given split() came from this text.
                continue
            stripped = piece.strip()
            if stripped:
                # Char span covers the stripped surface form.
                lead = len(piece) - len(piece.lstrip())
                start = idx + lead
                end = start + len(stripped)
                out.append((stripped, start, end))
            cursor = idx + len(piece)
        return out

    def _split_with_blanks(self, text: str) -> list[tuple[str, int, int]]:
        out: list[tuple[str, int, int]] = []
        cursor = 0
        for piece in re.split(r"\n\s*\n", text):
            idx = text.find(piece, cursor)
            if idx < 0:
                continue
            stripped = piece.strip()
            if stripped:
                lead = len(piece) - len(piece.lstrip())
                start = idx + lead
                end = start + len(stripped)
                out.append((stripped, start, end))
            cursor = idx + len(piece)
        return out

    def _enforce_max_chars(
        self, triples: list[tuple[str, int, int]]
    ) -> list[tuple[str, int, int, int]]:
        """Chop any sentence longer than ``max_sentence_chars`` into fragments.

        Offsets are preserved: a 5000-char sentence at offset 100 with
        cap=2000 becomes (text[0:2000], 100, 2100), (text[2000:4000],
        2100, 4100), (text[4000:5000], 4100, 5100).

        Each output tuple is ``(text, start, end, sentence_index)`` where
        ``sentence_index`` is the 0-based index of the *original* sentence
        in ``triples``. Fragments split out of one sentence share that
        index — they're chops of the same sentence, not new sentences.
        """
        cap = self.max_sentence_chars
        out: list[tuple[str, int, int, int]] = []
        for sent_idx, (sent, start, end) in enumerate(triples):
            if len(sent) <= cap:
                out.append((sent, start, end, sent_idx))
                continue
            i = 0
            while i < len(sent):
                fragment = sent[i : i + cap]
                out.append((fragment, start + i, start + i + len(fragment), sent_idx))
                i += cap
        return out

    def _parse_one(self, sentence: str) -> str:
        """Parse a single sentence to PENMAN. Synchronous; called via ``to_thread``.

        amrlib's ``parse_sents`` returns a list of PENMAN strings (one per
        input sentence). We call it with a single-element list per
        sentence so a failure on one doesn't poison the others — see the
        sentence-isolation contract in the module docstring.
        """
        parser = self._load_parser()
        graphs = parser.parse_sents([sentence])
        if not graphs:
            raise RuntimeError("amrlib returned no graph for input")
        graph = graphs[0]
        if graph is None:
            raise RuntimeError("amrlib returned None for input (parser failure)")
        return graph

    async def parse(self, text: str) -> list[AmrSentenceParse]:
        """Parse ``text`` into one ``AmrSentenceParse`` per sentence.

        Splits ``text`` into sentences (preserving char offsets in the
        original text), then parses each one. Per-sentence parse errors
        are caught and recorded on that record's ``parse_error`` field
        rather than propagated, so one bad sentence never kills the
        chunk.

        Empty-input contract:

          * ``""`` and pure-whitespace input return ``[]`` — no records.
          * **Pure-punctuation input** (``"..."``, ``"!!!"``, etc.) does
            NOT return ``[]``. The splitter treats it as one
            non-whitespace sentence and emits one record. The downstream
            AMR parser will typically fail on it and that record will
            carry ``parse_error``. This is deliberate — silently
            dropping non-empty text would hide upstream chunker bugs.
            Callers wanting strict alphanumeric-only chunks should
            filter before calling ``parse()``.
        """
        sentences = self._split_sentences(text)
        if not sentences:
            return []

        results: list[AmrSentenceParse] = []
        for sent_text, char_start, char_end, sent_idx in sentences:
            t0 = time.perf_counter()
            penman = ""
            parse_error: str | None = None
            try:
                # amrlib is synchronous CPU/GPU work — offload so the
                # event loop doesn't block while other extraction
                # clients run concurrently on the same chunk.
                penman = await asyncio.to_thread(self._parse_one, sent_text)
            except ImportError:
                # amrlib missing → the whole client is unusable; surface
                # immediately rather than recording per-sentence errors.
                raise
            except Exception as exc:  # noqa: BLE001 — sentence isolation by design
                parse_error = f"{type(exc).__name__}: {exc}"
                logger.warning(
                    "amr-parser: sentence %d failed (%d chars): %s",
                    sent_idx,
                    len(sent_text),
                    parse_error,
                )
            duration = time.perf_counter() - t0
            results.append(
                AmrSentenceParse(
                    sentence_text=sent_text,
                    sentence_index=sent_idx,
                    sentence_char_start=char_start,
                    sentence_char_end=char_end,
                    penman=penman,
                    parse_duration_s=duration,
                    parse_error=parse_error,
                )
            )

        ok = sum(1 for r in results if r.parse_error is None)
        logger.info(
            "amr-parser: %d sentence%s, %d ok, %d failed",
            len(results),
            "" if len(results) == 1 else "s",
            ok,
            len(results) - ok,
        )
        return results
