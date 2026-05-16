"""NuExtract adapter — wraps the nuextract model's <|input|>/<|output|> format
behind the same interface as LLMClient.

NuExtract is a 3.8B extraction-specialist model that uses a category-based
schema template instead of tool calling or json_mode. This adapter translates
between our Pydantic extraction schemas and nuextract's native format.

Usage:
    client = NuExtractClient()  # reads LLM_BASE_URL etc from env
    result = await client.structured_output(MentionExtractionResult, messages)
    # result is a MentionExtractionResult with computed spans
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any

import httpx
from pydantic import BaseModel

from catalyst_langgraph.clients._retry import retry_llm_call
from catalyst_langgraph.label_packs import LabelPack, load_generic_label_pack

logger = logging.getLogger(__name__)


def _build_nuextract_template(template: dict[str, Any]) -> str:
    """Serialise a label-pack template into the JSON string NuExtract consumes."""
    return json.dumps(template)


def _walk_template_paths(template: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """Map every leaf path in a NuExtract template → its key string.

    Used at parse-time to project nested JSON output back to flat
    ``(canonical_type, span)`` records. Path notation matches the
    ``canonical_type_map`` keys in the label pack: dot-separated keys with
    ``[]`` for list entries (e.g. ``"Bill.Cosponsors[].State"``).
    """
    paths: dict[str, str] = {}
    for key, value in template.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            paths.update(_walk_template_paths(value, path))
        elif isinstance(value, list) and value and isinstance(value[0], dict):
            paths.update(_walk_template_paths(value[0], f"{path}[]"))
        else:
            paths[path] = key
    return paths


def _flatten_nuextract_output(
    parsed: Any,
    canonical_type_map: dict[str, str],
    raw_text: str,
    prefix: str = "",
) -> dict[tuple[str, str], dict]:
    """Walk parsed NuExtract output, emit deduped mentions keyed by ``(text_lower, canonical_type)``.

    Handles arbitrary nesting: dicts, lists of strings, lists of dicts. Each
    leaf value is matched against its path in ``canonical_type_map`` to
    determine the mention's canonical_type.
    """
    mentions: dict[tuple[str, str], dict] = {}

    def emit(text_value: str, path: str) -> None:
        canonical_type = canonical_type_map.get(path, "OTHER")
        text_value = text_value.strip()
        if not text_value:
            return
        spans = _compute_spans(raw_text, text_value)
        if spans:
            span_start, span_end = spans[0]
            surface = text_value
        else:
            lower_spans = _compute_spans(raw_text.lower(), text_value.lower())
            if lower_spans:
                span_start, span_end = lower_spans[0]
                surface = raw_text[span_start:span_end]
            else:
                span_start, span_end = 0, 0
                surface = text_value
        key = (surface.lower(), canonical_type)
        if key not in mentions:
            mentions[key] = {
                "text": surface,
                "mention_type": canonical_type,
                "span_start": span_start,
                "span_end": span_end,
                "confidence": 0.9,
            }

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            list_path = f"{path}[]"
            for entry in node:
                if isinstance(entry, dict):
                    walk(entry, list_path)
                elif isinstance(entry, str):
                    emit(entry, list_path)
                # Ignore numeric/null list entries — those are typed fields
                # (integer counts, dates) that aren't span-extractable.
        elif isinstance(node, str):
            emit(node, path)
        # Ignore integers / booleans / nulls — they're typed-field values,
        # not spans (e.g. RollCallVotes[].YeaCount = 218).

    walk(parsed, prefix)
    return mentions


def _compute_spans(text: str, entity_text: str) -> list[tuple[int, int]]:
    """Find all occurrences of entity_text in text, return (start, end) pairs.

    NOTE: Duplicate of catalyst_exgraph.nodes.spans.find_all_spans.
    Cannot import directly because catalyst-langgraph-aio does not depend on
    catalyst-exgraph (the dependency runs the other direction).  If the
    dependency is ever added, replace this with:
        from catalyst_exgraph.nodes.spans import find_all_spans as _compute_spans
    """
    spans = []
    start = 0
    while True:
        idx = text.find(entity_text, start)
        if idx == -1:
            break
        spans.append((idx, idx + len(entity_text)))
        start = idx + 1
    return spans


class NuExtractClient:
    """Adapter that calls nuextract via Ollama and returns results matching
    our Pydantic extraction schemas.

    Supports both NuExtract 1.5 (Phi-3.5, <|input|>/<|output|> format) and
    NuExtract 2.0 (Qwen2.5-VL, ### Template: format). Auto-detects version
    from model name.

    Config from environment (same vars as LLMClient):
    - LLM_BASE_URL: Ollama base (default http://localhost:11434)
    - LLM_MODEL: model name (default nuextract:latest)
    - LLM_TIMEOUT: request timeout in seconds (default 300)
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        timeout: int | None = None,
        label_pack: LabelPack | None = None,
    ) -> None:
        raw_url = base_url or os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1")
        self.base_url = raw_url.rstrip("/").removesuffix("/v1")
        self.model = model or os.environ.get("LLM_MODEL", "nuextract:latest")
        self.timeout = timeout or int(os.environ.get("LLM_TIMEOUT", "300"))
        # Auto-detect version: "nuextract2" or "2.0" → v2 format
        self.is_v2 = "2" in self.model.lower().replace("nuextract1", "").replace("1.5", "")
        self.structured_method = "nuextract"
        self.temperature = 0.0

        # Label pack provides the template + canonical_type_map. Fall back to
        # the bundled generic pack when none is supplied.
        self.label_pack = label_pack or load_generic_label_pack()

    @retry_llm_call(name="nuextract")
    async def _call_llm(self, prompt: str) -> str:
        """Send a request to the LLM and return the response text.

        NuExtract 1.5 (Phi-3): uses /api/generate with raw mode and manually
        baked Phi-3 chat template to avoid double-wrapping.

        NuExtract 2.0 (Qwen2.5): uses /api/chat which correctly applies the
        Qwen im_start/im_end template.

        Wrapped in retry_llm_call (CD-58ry): transient Ollama 5xx /
        connection-reset errors retry up to 3 times with exponential
        backoff + full jitter; non-transient errors (4xx besides 408/429,
        JSON parse failures) propagate immediately.
        """
        is_ollama = ":11434" in self.base_url

        if is_ollama and self.is_v2:
            # v2 (Qwen2.5 template) — use /api/chat, template handles wrapping
            ollama_base = self.base_url.rstrip("/").removesuffix("/v1")
            url = f"{ollama_base}/api/chat"
            payload = {
                "model": self.model,
                "stream": False,
                "messages": [{"role": "user", "content": prompt}],
                "options": {"temperature": 0.0},
            }
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["message"]["content"]
        elif is_ollama:
            # v1.5 (Phi-3 template) — use /api/generate with raw mode
            formatted = f"<|user|>\n{prompt}<|end|>\n<|assistant|>\n"
            ollama_base = self.base_url.rstrip("/").removesuffix("/v1")
            url = f"{ollama_base}/api/generate"
            payload = {
                "model": self.model,
                "prompt": formatted,
                "stream": False,
                "raw": True,
                "options": {"temperature": 0.0},
            }
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["response"]
        else:
            base = self.base_url.rstrip("/")
            if not base.endswith("/v1"):
                base = f"{base}/v1"
            url = f"{base}/chat/completions"
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 4096,
            }
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]

    def _parse_nuextract_output(self, raw: str) -> dict:
        """Parse nuextract's output, stripping template markers."""
        text = raw.strip()
        # Remove <|end-output|> and any trailing content
        text = text.split("<|end-output|>")[0].strip()
        # Remove <|output|> tags (may appear with varying whitespace)
        text = re.sub(r"<\|output\|>\s*", "", text).strip()
        # Find the JSON object in the remaining text
        start = text.find("{")
        if start == -1:
            logger.warning("nuextract: no JSON object found in output: %s", text[:200])
            return {}
        # Find matching closing brace
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start : i + 1])
        # Fallback: try parsing from the first brace
        return json.loads(text[start:])

    async def complete(self, prompt: str, *, system: str = "") -> str:
        """Simple completion — just wraps the Ollama call."""
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        return await self._call_llm(full_prompt)

    async def structured_output(self, schema: type[BaseModel], messages: list[Any]) -> BaseModel:
        """Extract structured data using nuextract's native template format.

        Translates MentionExtractionResult / PropositionExtractionResult schemas
        into nuextract's category-based template, calls the model, and converts
        the response back into the expected Pydantic model.
        """
        # Get the raw text from messages (HumanMessage content)
        raw_text = ""
        for m in messages:
            content = getattr(m, "content", str(m))
            if hasattr(m, "type") and m.type == "human":
                raw_text = content
                break
        if not raw_text:
            raw_text = str(messages[-1].content) if messages else ""

        schema_name = schema.__name__
        logger.info(
            "nuextract.structured_output: model=%s, schema=%s, input_len=%d",
            self.model,
            schema_name,
            len(raw_text),
        )
        t0 = time.perf_counter()

        if "Mention" in schema_name:
            result = await self._extract_mentions(raw_text, schema)
        elif "Proposition" in schema_name:
            result = await self._extract_propositions(raw_text, messages, schema)
        else:
            raise ValueError(f"NuExtractClient doesn't support schema: {schema_name}")

        elapsed = time.perf_counter() - t0
        logger.info("nuextract.structured_output: done, schema=%s, duration=%.3fs", schema_name, elapsed)
        return result

    async def _extract_mentions(self, raw_text: str, schema: type[BaseModel]) -> BaseModel:
        """Extract entity mentions using the label pack's NuExtract template.

        NuExtract 2.0 (8B, Qwen2.5): handles full text, uses ### Template: format
        with verbatim-string type annotations.

        NuExtract 1.5 (3.8B, Phi-3): uses sliding window (degenerates >600 chars)
        with <|input|>/<|output|> format.
        """
        if self.is_v2:
            return await self._extract_mentions_v2(raw_text, schema)
        MAX_WINDOW_CHARS = 500
        OVERLAP_CHARS = 50

        if len(raw_text) <= MAX_WINDOW_CHARS:
            windows = [(0, raw_text)]
        else:
            windows = []
            start = 0
            while start < len(raw_text):
                end = min(start + MAX_WINDOW_CHARS, len(raw_text))
                windows.append((start, raw_text[start:end]))
                start += MAX_WINDOW_CHARS - OVERLAP_CHARS
            logger.info("nuextract: splitting %d chars into %d windows", len(raw_text), len(windows))

        template_obj = self.label_pack.nuextract.template
        canonical_type_map = self.label_pack.nuextract.canonical_type_map
        if not template_obj:
            logger.warning(
                "nuextract: label pack %r has no template; nothing to extract",
                self.label_pack.name,
            )
            from catalyst_exgraph.models.extraction_output import MentionCandidate  # noqa: F401

            return schema(mentions=[])
        template = _build_nuextract_template(template_obj)
        all_mentions: dict[tuple[str, str], dict] = {}

        for window_offset, window_text in windows:
            prompt = f"<|input|>\n{window_text}\n<|output|>\n{template}"
            try:
                response = await self._call_llm(prompt)
                parsed = self._parse_nuextract_output(response)
            except Exception as e:
                logger.warning("nuextract: window at offset %d failed: %s", window_offset, e)
                continue

            # Compute spans against FULL source text, not the window
            window_mentions = _flatten_nuextract_output(parsed, canonical_type_map, raw_text)
            all_mentions.update(window_mentions)

        from catalyst_exgraph.models.extraction_output import MentionCandidate

        return schema(mentions=[MentionCandidate(**m) for m in all_mentions.values()])

    async def _extract_propositions(self, raw_text: str, messages: list[Any], schema: type[BaseModel]) -> BaseModel:
        """Extract propositions using nuextract.

        Propositions are harder for nuextract since it's designed for entity
        extraction. We use a simple template with subject/predicate/object slots.
        """
        template = json.dumps(
            {
                "propositions": [
                    {
                        "subject": "",
                        "predicate": "",
                        "object": "",
                    }
                ]
            }
        )
        prompt = f"<|input|>\n{raw_text}\n<|output|>\n{template}"

        response = await self._call_llm(prompt)
        parsed = self._parse_nuextract_output(response)

        propositions = []
        for p in parsed.get("propositions", []):
            subj = p.get("subject", "").strip()
            pred = p.get("predicate", "").strip()
            obj = p.get("object", "").strip()
            if subj and pred and obj:
                propositions.append(
                    {
                        "subject": subj,
                        "predicate": pred,
                        "object": obj,
                        "confidence": 0.8,
                        "evidence": "",
                    }
                )

        from catalyst_exgraph.models.extraction_output import PropositionCandidate

        return schema(propositions=[PropositionCandidate(**p) for p in propositions])

    async def _extract_mentions_v2(self, raw_text: str, schema: type[BaseModel]) -> BaseModel:
        """NuExtract 2.0 extraction — uses ### Template: format with verbatim-string types.

        The 8B model handles full text without sliding window. The template
        comes from the label pack so domain-specific schemas (nested sponsor
        objects, typed enums, etc.) flow through unchanged.
        """
        template_obj = self.label_pack.nuextract.template
        canonical_type_map = self.label_pack.nuextract.canonical_type_map
        if not template_obj:
            logger.warning(
                "nuextract v2: label pack %r has no template; nothing to extract",
                self.label_pack.name,
            )
            from catalyst_exgraph.models.extraction_output import MentionCandidate  # noqa: F401

            return schema(mentions=[])

        prompt = f"{raw_text}\n\n### Template:\n{json.dumps(template_obj)}"

        response = await self._call_llm(prompt)
        parsed = self._parse_nuextract_output(response)

        from catalyst_exgraph.models.extraction_output import MentionCandidate

        mentions = _flatten_nuextract_output(parsed, canonical_type_map, raw_text)

        return schema(mentions=[MentionCandidate(**m) for m in mentions.values()])
