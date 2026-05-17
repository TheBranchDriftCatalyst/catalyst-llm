"""RegexNerClient — deterministic 4th NER voter for the ensemble.

Patterns come from the label pack's ``regex`` section. Matches carry
``confidence=1.0`` because the patterns are intentionally tight; the
consensus voter treats them as authoritative for the canonical types
listed in ``regex.authoritative_for``.

Usage:
    client = RegexNerClient(label_pack=congress_pack)
    result = await client.structured_output(MentionExtractionResult, messages)
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from pydantic import BaseModel

from catalyst_langgraph.label_packs import LabelPack, load_generic_label_pack

logger = logging.getLogger(__name__)


class RegexNerClient:
    """Adapter that runs compiled regex patterns over raw text and wraps the
    matches in the standard MentionExtractionResult schema, so it can be
    dropped into the ensemble alongside GLiNER / NuExtract / UniversalNER
    without any node-level changes.

    The patterns are compiled once at construction.  Confidence is always
    1.0 (regex matches are deterministic); ranking falls back to whichever
    canonical type matches first when patterns overlap.
    """

    def __init__(
        self,
        *,
        label_pack: LabelPack | None = None,
        model_name: str = "regex-ner",
    ) -> None:
        self.label_pack = label_pack or load_generic_label_pack()
        self.model = model_name
        self.model_name = model_name
        self.structured_method = "regex"
        self.temperature = 0.0

        # Compile once. Per-pattern errors are logged and skipped so a
        # single bad regex doesn't kill the whole voter.
        compiled: list[tuple[str, re.Pattern[str]]] = []
        for canonical_type, patterns in self.label_pack.regex.patterns.items():
            for raw in patterns:
                try:
                    compiled.append((canonical_type, re.compile(raw)))
                except re.error as exc:
                    logger.warning(
                        "regex-ner: pack=%s type=%s skipping invalid pattern %r: %s",
                        self.label_pack.name,
                        canonical_type,
                        raw,
                        exc,
                    )
        self._compiled = compiled
        self._authoritative_for = set(self.label_pack.regex.authoritative_for)

    async def complete(self, prompt: str, *, system: str = "") -> str:
        raise NotImplementedError("RegexNerClient is NER-only, use structured_output()")

    async def structured_output(self, schema: type[BaseModel], messages: list[Any]) -> BaseModel:
        """Run all compiled patterns, dedupe by span+type, return mentions.

        Regex is NER-only. Any non-Mention schema raises ValueError.
        """
        raw_text = ""
        for m in messages:
            content = getattr(m, "content", str(m))
            if hasattr(m, "type") and m.type == "human":
                raw_text = content
                break
        if not raw_text:
            raw_text = str(messages[-1].content) if messages else ""

        if "Mention" in schema.__name__:
            return self._extract_mentions(raw_text, schema)
        raise ValueError(f"RegexNerClient only supports MentionExtractionResult; got {schema.__name__!r}")

    def _extract_mentions(self, raw_text: str, schema: type[BaseModel]) -> BaseModel:
        from catalyst_exgraph.models.extraction_output import MentionCandidate

        if not self._compiled:
            return schema(mentions=[])

        t0 = time.perf_counter()
        # Dedupe key includes canonical_type so the same span tagged by two
        # different patterns (e.g. a state postal code matching both
        # STATE_POSTAL and GPE) survives as two separate votes.
        seen: dict[tuple[int, int, str], dict[str, Any]] = {}
        for canonical_type, pattern in self._compiled:
            for match in pattern.finditer(raw_text):
                span_start, span_end = match.span()
                if span_start == span_end:
                    continue
                key = (span_start, span_end, canonical_type)
                if key in seen:
                    continue
                seen[key] = {
                    "text": match.group(0),
                    "mention_type": canonical_type,
                    "span_start": span_start,
                    "span_end": span_end,
                    "confidence": 1.0,
                }
        elapsed = time.perf_counter() - t0
        logger.info(
            "regex-ner: pack=%s, %d chars, %d patterns → %d matches in %.3fs",
            self.label_pack.name,
            len(raw_text),
            len(self._compiled),
            len(seen),
            elapsed,
        )

        mentions = [MentionCandidate(**m) for m in seen.values()]
        return schema(mentions=mentions)

    def is_authoritative_for(self, canonical_type: str) -> bool:
        """Used by the consensus voter to break ties on format-validated IDs."""
        return canonical_type in self._authoritative_for
