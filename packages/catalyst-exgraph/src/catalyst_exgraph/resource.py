"""ExtractionResource — Dagster ConfigurableResource for extraction.

The primary consumer interface for catalyst-exgraph. Assets declare this
as a dependency and call extract_mentions() or extract_assertions().

Usage in code location __init__.py:
    resources = {
        "extraction": ExtractionResource(
            ner_model="gliner",
            spo_model="mistral:latest",
            prompt_dir="k8s/media-ingest/prompts",
        ),
    }

Usage in assets:
    @asset
    def media_mentions(media_chunks, extraction: ExtractionResource):
        result = extraction.extract_mentions(media_chunks, code_location="media_ingest")
        return result.mentions
"""

from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dagster import ConfigurableResource

from catalyst_exgraph.chunk_io import field as _chunk_field
from catalyst_exgraph.config import StageConfig, ner_stage_config
from catalyst_exgraph.pipeline import build_ensemble_pipeline
from catalyst_exgraph.protocol import ExtractionResult
from catalyst_exgraph.state import ExGraphState

logger = logging.getLogger(__name__)


def _resolve_client(
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
    label_pack: Any = None,
):
    """Resolve model name to the appropriate extraction client.

    Centralizes client construction so all paths (v1, v2, benchmark, resource)
    go through one place. Explicitly passes base_url and api_key to avoid
    env var leakage from parent processes.

    ``label_pack`` (when provided) flows into the NER-flavoured clients
    (GLiNER, NuExtract, UniversalNER, regex) and drives their per-encoder
    prompt vocabularies. The LLM client ignores it; LLM prompting goes
    through the .prompt registry instead.
    """
    # GLiNER model name mapping
    GLINER_MODELS = {
        "gliner": "urchade/gliner_medium-v2.1",
        "gliner-medium": "urchade/gliner_medium-v2.1",
        "gliner-large": "urchade/gliner_large-v2.1",
        "gliner-small": "urchade/gliner_small-v2.1",
        "gliner-pii": "urchade/gliner_multi_pii-v1",
    }

    model_lower = model.lower()
    if model_lower in ("regex", "regex-ner") or model_lower.startswith("regex:"):
        from catalyst_langgraph.clients.regex_ner import RegexNerClient

        return RegexNerClient(label_pack=label_pack)
    if "gliner" in model_lower:
        from catalyst_langgraph.clients.gliner import GLiNERClient

        hf_model = GLINER_MODELS.get(model_lower, GLINER_MODELS.get(model, "urchade/gliner_medium-v2.1"))
        return GLiNERClient(model_name=hf_model, label_pack=label_pack)
    elif "nuextract" in model_lower:
        from catalyst_langgraph.clients.nuextract import NuExtractClient

        return NuExtractClient(base_url=base_url, model=model, label_pack=label_pack)
    elif "universalner" in model_lower or "uniner" in model_lower:
        from catalyst_langgraph.clients.universalner import UniversalNERClient

        return UniversalNERClient(base_url=base_url, model=model, label_pack=label_pack)
    else:
        # LLM-based mention extraction is intentionally disabled. The NER
        # ensemble (gliner + nuextract + universalner + regex) is the only
        # supported mention-extraction path. A silent LLMClient fallthrough
        # here previously routed every chunk through ChatGPT whenever
        # LLM_MODEL leaked into the ner_model slot (catalyst-data bug
        # tracked in the Phase-0 cost-bleed fix). Fail loudly instead.
        raise ValueError(
            f"_resolve_client: unrecognised NER model {model!r}. "
            f"Expected one of: gliner*, nuextract*, universalner*/uniner*, "
            f"regex*. LLM-based mention extraction is not supported — use "
            f"the NER ensemble for mentions, and reserve LLM use for "
            f"high-level claim synthesis (bill_claims)."
        )


def _build_mcp_client():
    """Build a thin DirectMCPClient — no validators in the AMR-spine path.

    Kept as a positional argument on NerEnsembleNode for signature
    uniformity. AMR projection emits AmrAssertion deterministically; no
    MCP-driven proposition validation is required.
    """
    from catalyst_langgraph.clients.mcp import DirectMCPClient

    class _NoopValidatorHandler:
        def validate_mentions(self, *args, **kwargs):
            return {"verdict": "accept", "errors": [], "valid_items": []}

    return DirectMCPClient(_NoopValidatorHandler())


class ExtractionResource(ConfigurableResource):
    """Dagster resource for AMR-as-spine extraction.

    Configurable per code location. The pipeline is single-path:
    NER ensemble → consensus → cluster → pack → AMR parse → AMR projection.
    """

    ner_model: str = "gliner"
    """Model for NER/mention extraction. Default 'gliner' picks the bundled
    bi-encoder; other valid values: 'nuextract', 'universalner', 'regex',
    or any LLM model name routed via _resolve_client."""

    prompt_dir: str = ""
    """Directory containing .prompt files + the label pack YAML. Domain-
    specific (e.g. 'k8s/media-ingest/prompts', 'k8s/congress-data/prompts')."""

    label_pack_id: str = ""
    """Label pack id (looked up under ``prompt_dir`` first, then catalyst-
    langgraph's bundled packs). Drives every voter in the ensemble + AMR
    frame mapping. Empty string → bundled 'generic' pack (zero amr_frames,
    so the AMR projection will emit no assertions — set this to 'congress'
    or 'media' for real output)."""

    amr_sentence_splitter: str = "spacy"
    """Sentence splitter for the AMR parser. One of ``"spacy"`` (preferred),
    ``"regex"`` (degraded fallback that over-segments at abbreviation
    periods), or ``"blanks"``."""

    max_concurrency: int = 5
    """Max parallel chunk processing."""

    ner_ensemble: list[str] | None = None
    """List of model names for the multi-voter NER ensemble. None → use
    just ``ner_model`` as a single encoder (recommended for quick demos;
    real corpora should set the 4-voter list: gliner / nuextract /
    universalner / regex)."""

    # Consensus expression overriding default ⌈N/2⌉ majority. Uses
    # single-letter variables mapped to ``ner_ensemble`` in order.
    # Examples: "a + b + c >= 2" (3-majority), "a & (b | c)" (logical).
    # See ``catalyst_exgraph.consensus_predicate.compile_consensus_expr``.
    ner_quorum_expr: str | None = None
    """Consensus expression like ``"a + b + c >= 2"``. None → simple majority."""

    def _load_label_pack(self) -> Any:
        """Load the label pack identified by ``label_pack_id`` (or generic).

        Resolution: ``<prompt_dir>/<id>.labels.yaml`` first, then bundled
        packs in catalyst-langgraph. Errors propagate — a misconfigured
        pack_id should fail loudly rather than silently use the wrong vocab.
        """
        from catalyst_langgraph.label_packs import load_generic_label_pack, load_label_pack

        if not self.label_pack_id:
            return load_generic_label_pack()
        return load_label_pack(self.prompt_dir or None, self.label_pack_id)

    def _build_ner_config(self) -> StageConfig:
        return ner_stage_config(
            model=self.ner_model,
            max_retries=0,  # encoders are deterministic; no repair loop
            ensemble_models=self.ner_ensemble,
        )

    def _stamp_overrides(self, stage: StageConfig) -> StageConfig:
        """Stamp prompt_dir + label_pack_id onto a frozen StageConfig."""
        overrides: dict[str, Any] = {}
        if self.prompt_dir:
            overrides["prompt_dir"] = self.prompt_dir
        if self.label_pack_id:
            overrides["label_pack_id"] = self.label_pack_id
        if not overrides:
            return stage
        return StageConfig(**{**stage.__dict__, **overrides})

    def extract_mentions(
        self,
        chunks: list,
        code_location: str = "",
    ) -> ExtractionResult:
        """Extract entity mentions (NER) only — no AMR projection.

        Runs the NER half of the pipeline: ensemble → consensus → cluster
        → pack. Returns mentions on ``ExtractionResult.mentions``.
        """
        label_pack = self._load_label_pack()
        ner_config = self._stamp_overrides(self._build_ner_config())
        ner_client = _resolve_client(self.ner_model, label_pack=label_pack)
        clients: dict[str, ExtractionClient] = {
            ner_config.model_override or ner_config.stage_name: ner_client
        }
        mcp_client = _build_mcp_client()
        pipeline = build_ensemble_pipeline(
            encoders=[ner_config],
            clients=clients,
            mcp_client=mcp_client,
        )
        return self._run_ner_only_pipeline(pipeline, chunks, code_location, label_pack)

    def extract_assertions(
        self,
        chunks: list,
        accepted_mentions: list | None = None,
        code_location: str = "",
    ) -> ExtractionResult:
        """Extract propositions via AMR-as-spine projection.

        Routes chunks through: NER ensemble → consensus → cluster → pack →
        AMR parse → AMR-to-assertion projection. Returns an
        ``ExtractionResult`` whose ``assertions`` list is built from
        ``AmrAssertion`` records.

        Requires the active label pack to declare ``amr_frames``. The
        bundled ``generic`` pack has an empty frame table — supply a
        domain pack (``label_pack_id="congress"`` / ``"media"``) for
        meaningful output.

        This is the ONLY assertion path. The legacy SPO LLM stage was
        retired when the AMR-as-spine refactor landed (greenfield
        single-operator dev environment — no migration to manage).
        ``LLMClient`` still exists in catalyst-langgraph for predicate
        canonicalization on unknown AMR frames and general LLM use, but
        ``ExtractionResource`` no longer invokes it for the assertion
        path.
        """
        from catalyst_langgraph.clients.amr_parser import AmrParserClient

        label_pack = self._load_label_pack()
        if not label_pack.has_amr_frames():
            logger.warning(
                "extract_assertions: label pack %r has no amr_frames "
                "section; AMR projection will emit zero or all-novel "
                "assertions. Set label_pack_id='congress' or 'media'.",
                label_pack.name,
            )

        amr_parser = AmrParserClient(sentence_splitter=self.amr_sentence_splitter)
        return self._run_amr_pipeline(
            chunks=chunks,
            label_pack=label_pack,
            amr_parser=amr_parser,
            upstream_mentions=accepted_mentions or [],
            code_location=code_location,
        )

    def _run_amr_pipeline(
        self,
        chunks: list,
        label_pack: Any,
        amr_parser: Any,
        upstream_mentions: list,
        code_location: str,
    ) -> ExtractionResult:
        """Build + invoke the AMR pipeline for each chunk, collect Assertions.

        Threaded chunk loop mirrors ``_run_pipeline()``. Each chunk gets
        its own ExGraphState; the AMR projection writes
        ``state["amr_assertions"]`` directly as
        ``catalyst_contracts_core.Assertion`` objects (Provenance stamped
        inside the projection node), so this method just collects and
        returns them on ``ExtractionResult.assertions``.
        """
        from catalyst_contracts_core import (
            Assertion,
            ExtractionMethod,
            Mention,
            Provenance,
        )

        from catalyst_exgraph.pipeline import build_amr_pipeline
        from catalyst_exgraph.state import ExGraphState

        if not chunks:
            return ExtractionResult()

        # Build a single ensemble (NER) config — the AMR pipeline reuses the
        # ensemble path for the NER half before projecting.
        ner_config = self._stamp_overrides(self._build_ner_config())

        # Resolve encoder clients for the ensemble. For now, we keep the
        # single-NER fast path: one encoder with the resource's ner_model.
        # Ensemble mode (multi-encoder) is wired via ner_ensemble = ["...", ...].
        ner_client = _resolve_client(self.ner_model, label_pack=label_pack)
        clients: dict[str, ExtractionClient] = {
            ner_config.model_override or ner_config.stage_name: ner_client
        }
        mcp_client = _build_mcp_client()

        pipeline = build_amr_pipeline(
            encoders=[ner_config],
            clients=clients,
            mcp_client=mcp_client,
            amr_parser_client=amr_parser,
            label_pack=label_pack,
        )

        all_mentions: list[dict] = []
        all_amr_assertions: list[Any] = []
        all_audit_events: list[dict] = []
        errors = 0
        start = time.monotonic()

        def _run_chunk(chunk) -> dict:
            loop = asyncio.new_event_loop()
            try:
                state: ExGraphState = {
                    "raw_text": _chunk_field(chunk, "text"),
                    "source_metadata": {
                        "document_id": _chunk_field(chunk, "document_id"),
                        "chunk_id": _chunk_field(chunk, "chunk_id"),
                    },
                    "stages": {},
                    "upstream_context": {
                        "accepted_mentions": [
                            m.model_dump(mode="json") if hasattr(m, "model_dump") else m
                            for m in upstream_mentions
                        ],
                    } if upstream_mentions else {},
                    "audit_events": [],
                    "amr_audit_events": [],
                    "status": "pending",
                }
                result = loop.run_until_complete(pipeline.ainvoke(state))
                return {
                    "consensus_mentions": result.get("consensus_mentions", []) or [],
                    "amr_assertions": result.get("amr_assertions", []) or [],
                    "audit_events": result.get("audit_events", []) or [],
                    "amr_audit_events": result.get("amr_audit_events", []) or [],
                    "chunk_metadata": _chunk_field(chunk, "metadata", {}) or {},
                    "chunk_id": _chunk_field(chunk, "chunk_id"),
                    "document_id": _chunk_field(chunk, "document_id"),
                }
            finally:
                loop.close()

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as pool:
            futures = {pool.submit(_run_chunk, chunk): chunk for chunk in chunks}
            for future in as_completed(futures):
                try:
                    res = future.result()
                except Exception:
                    logger.exception("_run_amr_pipeline: chunk failed")
                    errors += 1
                    continue
                all_mentions.extend(res["consensus_mentions"])
                all_amr_assertions.extend(res["amr_assertions"])
                all_audit_events.extend(res["audit_events"])
                all_audit_events.extend(res["amr_audit_events"])

        duration = time.monotonic() - start

        # Convert ConsensusMention dicts to unified Mention objects. The
        # consensus mentions dicts carry vote_count / source_models etc.
        # natively — same shape as the unified Mention.
        mention_models = []
        for m in all_mentions:
            mention_models.append(
                Mention(
                    mention_id=m.get("mention_id", ""),
                    text=m.get("text", ""),
                    canonical_type=m.get("canonical_type", "OTHER"),
                    span_start=m.get("span_start", 0) or 0,
                    span_end=m.get("span_end", 0) or 0,
                    vote_count=m.get("vote_count", 1),
                    n_encoders=m.get("n_encoders", 1),
                    source_models=m.get("source_models", []) or [],
                    mean_confidence=m.get("mean_confidence", 1.0),
                    span_provenance=m.get("span_provenance"),
                    context=m.get("context", ""),
                    provenance=Provenance(
                        source_document_id=m.get("document_id", ""),
                        chunk_id=m.get("chunk_id", ""),
                        span_start=m.get("span_start"),
                        span_end=m.get("span_end"),
                        extraction_method=ExtractionMethod.NER_ENSEMBLE,
                        extraction_model=f"ner_ensemble+{self.ner_model}",
                        confidence=m.get("mean_confidence", 1.0),
                        code_location=code_location,
                    ),
                )
            )

        # The AMR projection node emits unified Assertions directly with
        # Provenance already stamped from the chunk + sentence range. The
        # only thing we still need to fill in is ``code_location``, which
        # is a caller concern and unknown to the projection node.
        # Provenance is frozen (QA-1 hardened it to prevent wire-shape
        # mutation), so we model_copy(update=...) instead of assigning.
        assertion_models: list[Assertion] = []
        for a in all_amr_assertions:
            if code_location and getattr(a, "provenance", None) is not None and not a.provenance.code_location:
                new_provenance = a.provenance.model_copy(update={"code_location": code_location})
                a = a.model_copy(update={"provenance": new_provenance})
            assertion_models.append(a)

        return ExtractionResult(
            mentions=mention_models,
            assertions=assertion_models,
            stats={
                "chunk_count": len(chunks),
                "duration_s": round(duration, 1),
                "mention_count": len(mention_models),
                "assertion_count": len(assertion_models),
                "errors": errors,
                "pipeline": "amr",
            },
            audit_events=all_audit_events,
        )

    def extract_all(
        self,
        chunks: list,
        code_location: str = "",
    ) -> ExtractionResult:
        """Extract mentions + assertions in one call.

        Single pass through the AMR-as-spine pipeline: NER ensemble →
        consensus → cluster → pack → AMR parse → AMR-to-assertion
        projection. The returned ``ExtractionResult`` carries both
        ``mentions`` (from the NER consensus) and ``assertions`` (from
        the AMR projection).
        """
        return self.extract_assertions(chunks=chunks, code_location=code_location)

    def _run_ner_only_pipeline(
        self,
        pipeline,
        chunks: list,
        code_location: str,
        label_pack: Any,
    ) -> ExtractionResult:
        """Run the NER-half pipeline across chunks; collect ConsensusMentions."""
        from catalyst_contracts_core import ExtractionMethod, Mention, Provenance

        if not chunks:
            return ExtractionResult()

        all_mentions: list[dict] = []
        all_audit_events: list[dict] = []
        errors = 0
        start = time.monotonic()

        def _run_chunk(chunk) -> dict:
            loop = asyncio.new_event_loop()
            try:
                state: ExGraphState = {
                    "raw_text": _chunk_field(chunk, "text"),
                    "source_metadata": {
                        "document_id": _chunk_field(chunk, "document_id"),
                        "chunk_id": _chunk_field(chunk, "chunk_id"),
                    },
                    "stages": {},
                    "upstream_context": {},
                    "audit_events": [],
                    "status": "pending",
                }
                result = loop.run_until_complete(pipeline.ainvoke(state))
                return {
                    "consensus_mentions": result.get("consensus_mentions", []) or [],
                    "audit_events": result.get("audit_events", []) or [],
                    "chunk_metadata": _chunk_field(chunk, "metadata", {}) or {},
                    "chunk_id": _chunk_field(chunk, "chunk_id"),
                    "document_id": _chunk_field(chunk, "document_id"),
                }
            finally:
                loop.close()

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as pool:
            futures = {pool.submit(_run_chunk, chunk): chunk for chunk in chunks}
            for future in as_completed(futures):
                try:
                    res = future.result()
                except Exception:
                    logger.exception("_run_ner_only_pipeline: chunk failed")
                    errors += 1
                    continue
                all_mentions.extend(res["consensus_mentions"])
                all_audit_events.extend(res["audit_events"])

        duration = time.monotonic() - start

        mention_models = []
        for m in all_mentions:
            mention_models.append(
                Mention(
                    mention_id=m.get("mention_id", ""),
                    text=m.get("text", ""),
                    canonical_type=m.get("canonical_type", "OTHER"),
                    span_start=m.get("span_start", 0) or 0,
                    span_end=m.get("span_end", 0) or 0,
                    vote_count=m.get("vote_count", 1),
                    n_encoders=m.get("n_encoders", 1),
                    source_models=m.get("source_models", []) or [],
                    mean_confidence=m.get("mean_confidence", 1.0),
                    span_provenance=m.get("span_provenance"),
                    context=m.get("context", ""),
                    provenance=Provenance(
                        source_document_id=m.get("document_id", ""),
                        chunk_id=m.get("chunk_id", ""),
                        span_start=m.get("span_start"),
                        span_end=m.get("span_end"),
                        extraction_method=ExtractionMethod.NER_ENSEMBLE,
                        extraction_model=f"ner_ensemble+{self.ner_model}",
                        confidence=m.get("mean_confidence", 1.0),
                        code_location=code_location,
                    ),
                )
            )

        return ExtractionResult(
            mentions=mention_models,
            assertions=[],
            stats={
                "chunk_count": len(chunks),
                "duration_s": round(duration, 1),
                "mention_count": len(mention_models),
                "assertion_count": 0,
                "errors": errors,
                "pipeline": "ner_only",
            },
            audit_events=all_audit_events,
        )
