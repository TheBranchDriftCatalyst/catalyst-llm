"""GLiNER adapter — wraps the GLiNER encoder model behind the LLMClient interface.

GLiNER is a 300M bidirectional transformer for zero-shot NER. It's NOT an LLM —
it runs locally via Python, no serving endpoint needed. ~0.1s per extraction on CPU.

pip install gliner

Usage:
    client = GLiNERClient()                         # generic label pack
    client = GLiNERClient(label_pack=congress_pack) # domain-tailored labels
    result = await client.structured_output(MentionExtractionResult, messages)

The label vocabulary, threshold, and window sizing all live in the LabelPack
(see ``catalyst_langgraph.label_packs``).  Each label_text in the pack carries
its canonical_type so the client emits ready-to-consensus output without a
reverse-lookup table.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from pydantic import BaseModel

from catalyst_langgraph.label_packs import LabelPack, load_generic_label_pack, load_label_pack

logger = logging.getLogger(__name__)


class GLiNERClient:
    """Adapter that runs GLiNER for entity extraction and wraps results
    in the same Pydantic schemas as LLMClient.structured_output().

    Config from environment:
    - GLINER_MODEL: HuggingFace model ID (default: urchade/gliner_medium-v2.1)
    - GLINER_THRESHOLD: minimum confidence score (default: 0.5)
    - GLINER_WINDOW_TOKENS: max tokens per inference window (default: 320 — leaves
      headroom under the 384-token architecture cap for label tokens + specials).
    - GLINER_WINDOW_OVERLAP_TOKENS: token overlap between windows (default: 32) so
      entities straddling a window boundary are caught in at least one window.
    """

    def __init__(
        self,
        *,
        model_name: str | None = None,
        threshold: float | None = None,
        window_tokens: int | None = None,
        window_overlap_tokens: int | None = None,
        label_pack: LabelPack | None = None,
    ) -> None:
        self.model_name = model_name or os.environ.get("GLINER_MODEL", "urchade/gliner_medium-v2.1")

        # Label pack drives the prompt. When the caller didn't pass one,
        # auto-select: gliner-pii model name → bundled pii pack, otherwise
        # the bundled generic pack. Explicit pack argument always wins.
        if label_pack is None:
            if "pii" in self.model_name.lower():
                label_pack = load_label_pack(None, "pii")
            else:
                label_pack = load_generic_label_pack()
        self.label_pack = label_pack
        gliner_cfg = self.label_pack.gliner

        # Constructor args still beat the pack so per-call overrides work.
        self.threshold = (
            threshold
            if threshold is not None
            else float(os.environ.get("GLINER_THRESHOLD", str(gliner_cfg.threshold)))
        )
        self.window_tokens = window_tokens or int(
            os.environ.get("GLINER_WINDOW_TOKENS", str(gliner_cfg.window_tokens))
        )
        self.window_overlap_tokens = window_overlap_tokens or int(
            os.environ.get("GLINER_WINDOW_OVERLAP_TOKENS", str(gliner_cfg.window_overlap_tokens))
        )
        self.flat_ner = gliner_cfg.flat_ner

        self._model = None
        # Expose for compatibility with code that reads these
        self.model = self.model_name
        self.structured_method = "gliner"
        self.temperature = 0.0

    def _get_model(self):
        """Lazy-load the GLiNER model on first use."""
        if self._model is None:
            from gliner import GLiNER

            logger.info("gliner: loading model %s", self.model_name)
            t0 = time.perf_counter()
            self._model = GLiNER.from_pretrained(self.model_name)
            logger.info("gliner: model loaded in %.1fs", time.perf_counter() - t0)
        return self._model

    async def complete(self, prompt: str, *, system: str = "") -> str:
        """Not supported — GLiNER is an encoder, not a generative model."""
        raise NotImplementedError("GLiNER is an encoder model, use structured_output() for extraction")

    async def structured_output(self, schema: type[BaseModel], messages: list[Any]) -> BaseModel:
        """Run GLiNER extraction and return results as the expected Pydantic schema.

        Handles MentionExtractionResult. For PropositionExtractionResult, returns
        empty propositions (GLiNER doesn't do relation extraction).
        """
        # Extract raw text from messages
        raw_text = ""
        for m in messages:
            content = getattr(m, "content", str(m))
            if hasattr(m, "type") and m.type == "human":
                raw_text = content
                break
        if not raw_text:
            raw_text = str(messages[-1].content) if messages else ""

        schema_name = schema.__name__

        if "Mention" in schema_name:
            return await self._extract_mentions(raw_text, schema)
        elif "Proposition" in schema_name:
            # GLiNER doesn't do relation extraction — return empty
            from catalyst_exgraph.models.extraction_output import PropositionExtractionResult

            return PropositionExtractionResult(propositions=[])
        else:
            raise ValueError(f"GLiNERClient doesn't support schema: {schema_name}")

    async def _extract_mentions(self, raw_text: str, schema: type[BaseModel]) -> BaseModel:
        """Run GLiNER NER on the text and convert to MentionExtractionResult.

        For inputs longer than GLINER_WINDOW_TOKENS the text is split into
        overlapping windows; entity spans are translated back into the
        original-text coordinate system and deduped by ``(span_start,
        span_end)``. The architecture caps at 384 tokens — without this,
        every entity past that point is silently dropped.
        """
        from catalyst_exgraph.models.extraction_output import MentionCandidate

        model = self._get_model()

        # Label pack drives the prompt. label_text → canonical_type map lets
        # us emit the consensus-ready type directly without a reverse lookup.
        label_to_canonical = self.label_pack.gliner.labels
        labels = list(label_to_canonical.keys())
        if not labels:
            logger.warning(
                "gliner: label pack %r has no gliner labels; nothing to extract",
                self.label_pack.name,
            )
            return schema(mentions=[])

        windows = list(self._iter_windows(raw_text))
        logger.info(
            "gliner: pack=%s, %d chars (%d window%s), %d labels, threshold=%.2f, flat=%s",
            self.label_pack.name,
            len(raw_text),
            len(windows),
            "" if len(windows) == 1 else "s",
            len(labels),
            self.threshold,
            self.flat_ner,
        )
        t0 = time.perf_counter()
        entities: list[dict[str, Any]] = []
        for window_text, window_offset in windows:
            # Pass flat_ner to GLiNER when the model supports it; older
            # GLiNER versions ignore unknown kwargs gracefully.
            try:
                preds = model.predict_entities(
                    window_text,
                    labels,
                    threshold=self.threshold,
                    flat_ner=self.flat_ner,
                )
            except TypeError:
                preds = model.predict_entities(window_text, labels, threshold=self.threshold)
            for e in preds:
                entities.append(
                    {
                        "text": e["text"],
                        "label": e["label"],
                        "score": e["score"],
                        "start": e["start"] + window_offset,
                        "end": e["end"] + window_offset,
                    }
                )
        elapsed = time.perf_counter() - t0
        logger.info("gliner: extracted %d entities in %.3fs", len(entities), elapsed)

        mentions = []
        seen_spans: set[tuple[int, int, str]] = set()
        for e in entities:
            # Dedupe by (start, end, label) — overlap windows will return the
            # same span twice for entities sitting in the overlap region.
            span_key = (e["start"], e["end"], e["label"])
            if span_key in seen_spans:
                continue
            seen_spans.add(span_key)

            mention_type = label_to_canonical.get(e["label"], "OTHER")
            mentions.append(
                MentionCandidate(
                    text=e["text"],
                    mention_type=mention_type,
                    span_start=e["start"],
                    span_end=e["end"],
                    confidence=round(e["score"], 3),
                )
            )

        return schema(mentions=mentions)

    def _iter_windows(self, raw_text: str):
        """Yield ``(window_text, char_offset_in_raw_text)`` tuples covering
        the full input, sized to fit GLiNER's subword-token cap.

        Token-aware: queries the model's HuggingFace tokenizer for actual
        subword counts (GLiNER's preprocessor truncates on subword length,
        not word count, so word-based heuristics blow past 384 on
        token-rich text).
        """
        # Tokenize with the model's tokenizer + offset_mapping so we can
        # translate token ranges back to character offsets in raw_text.
        tokenizer = self._get_model().data_processor.transformer_tokenizer
        encoding = tokenizer(
            raw_text,
            add_special_tokens=False,
            return_offsets_mapping=True,
            truncation=False,
        )
        offsets: list[tuple[int, int]] = encoding["offset_mapping"]
        n_tokens = len(offsets)

        if n_tokens <= self.window_tokens:
            yield raw_text, 0
            return

        step = max(1, self.window_tokens - self.window_overlap_tokens)
        i = 0
        while i < n_tokens:
            end = min(i + self.window_tokens, n_tokens)
            # First non-empty offset → window char_start; last → window char_end.
            char_start = next((s for s, _ in offsets[i:end] if s != 0 or i == 0), offsets[i][0])
            # Use the first token's start unconditionally, then the last token's end.
            char_start = offsets[i][0]
            char_end = offsets[end - 1][1]
            yield raw_text[char_start:char_end], char_start
            if end >= n_tokens:
                break
            i += step
