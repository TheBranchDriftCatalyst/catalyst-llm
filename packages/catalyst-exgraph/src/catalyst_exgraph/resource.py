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
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dagster import ConfigurableResource

from catalyst_exgraph.config import StageConfig, ner_stage_config, spo_stage_config
from catalyst_exgraph.pipeline import build_pipeline, pipeline_result_to_legacy
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
        from catalyst_langgraph.clients.llm import LLMClient

        return LLMClient(
            model=model,
            base_url=base_url or os.environ.get("LLM_BASE_URL"),
            api_key=api_key or os.environ.get("LLM_API_KEY", os.environ.get("OPENAI_API_KEY", "")),
        )


def _build_mcp_client():
    """Build a DirectMCPClient with real validators."""
    from catalyst_exgraph.validators.mention_validator import validate_mentions
    from catalyst_exgraph.validators.proposition_validator import validate_propositions
    from catalyst_langgraph.clients.mcp import DirectMCPClient

    class _ValidatorHandler:
        def validate_mentions(self, mentions, source_text, document_id):
            result = validate_mentions(mentions, source_text, document_id)
            return result.model_dump(mode="json")

        def validate_propositions(self, propositions, known_mention_ids, source_text):
            result = validate_propositions(propositions, set(known_mention_ids), source_text)
            return result.model_dump(mode="json")

    return DirectMCPClient(_ValidatorHandler())


class ExtractionResource(ConfigurableResource):
    """Dagster resource for LLM extraction with MCP validation.

    Configurable per code location with different models for NER vs SPO,
    optional ensemble, and domain-specific prompts.
    """

    ner_model: str = "gpt-4o-mini"
    """Model for NER/mention extraction (e.g. 'gliner', 'mistral:latest')."""

    spo_model: str = "gpt-4o-mini"
    """Model for SPO/proposition extraction (e.g. 'mistral:latest', 'llama3.1:8b')."""

    prompt_dir: str = ""
    """Directory containing .prompt files. Domain-specific prompts
    (e.g. 'k8s/media-ingest/prompts', 'k8s/congress-data/prompts')."""

    label_pack_id: str = ""
    """Label pack id (looked up under ``prompt_dir`` first, then catalyst-langgraph's
    bundled packs). Drives encoder prompts: GLiNER labels, NuExtract template,
    UniversalNER queries, regex patterns. Empty string → bundled 'generic' pack."""

    max_concurrency: int = 5
    """Max parallel chunk processing."""

    ner_max_retries: int = 3
    """Max repair cycles for NER. Set to 0 for encoder models (auto-detected)."""

    spo_max_retries: int = 3
    """Max repair cycles for SPO."""

    # Phase 4: Ensemble
    ner_ensemble: list[str] | None = None
    """List of model names for ensemble NER. None = single model."""

    spo_ensemble: list[str] | None = None
    """List of model names for ensemble SPO. None = single model."""

    # Phase 4 (CD-y4u0 / consensus expression): override the consensus
    # vote rule.  The expression uses single-letter variables that map to
    # ``ner_ensemble`` in order — ``a → ensemble[0]``, ``b → ensemble[1]``,
    # etc.  When unset (the default), the consensus stage uses
    # ``ceil(N/2)`` (simple majority).  Examples:
    #
    #     "a + b + c >= 2"      # majority of 3
    #     "a + b + c + d >= 3"  # 3-of-4 super-majority
    #     "2*a + b + c >= 3"    # encoder 'a' counts double
    #     "a & (b | c)"         # logical: a AND (b OR c)
    #
    # See ``catalyst_exgraph.consensus_predicate.compile_consensus_expr``
    # for the full grammar and pathology detection.  Expressions are
    # validated at execution time; misconfigurations (unreachable accept,
    # trivial accept, accepts-with-zero-votes) abort the run with a
    # diagnostic banner so silent low-quality runs are impossible.
    ner_quorum_expr: str | None = None
    """Consensus expression like ``"a + b + c >= 2"``. None → simple majority."""

    def _is_encoder(self, model: str) -> bool:
        """Check if model is an encoder (no repair capability)."""
        return any(x in model.lower() for x in ("gliner", "nuextract", "universalner", "uniner", "regex"))

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
        max_retries = 0 if self._is_encoder(self.ner_model) else self.ner_max_retries
        return ner_stage_config(
            model=self.ner_model,
            max_retries=max_retries,
            ensemble_models=self.ner_ensemble,
        )

    def _build_spo_config(self) -> StageConfig:
        return spo_stage_config(
            model=self.spo_model,
            max_retries=self.spo_max_retries,
        )

    def _apply_stage_overrides(self, stage: StageConfig) -> StageConfig:
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
        """Extract entity mentions (NER) only.

        Args:
            chunks: List of TextChunk objects.
            code_location: For metrics labeling.

        Returns:
            ExtractionResult with .mentions populated.
        """
        ner_config = self._apply_stage_overrides(self._build_ner_config())

        label_pack = self._load_label_pack()
        client = _resolve_client(self.ner_model, label_pack=label_pack)
        mcp_client = _build_mcp_client()
        pipeline = build_pipeline([ner_config], client, mcp_client)

        return self._run_pipeline(pipeline, chunks, code_location, ner_only=True)

    def extract_assertions(
        self,
        chunks: list,
        accepted_mentions: list | None = None,
        code_location: str = "",
    ) -> ExtractionResult:
        """Extract propositions (SPO) only, using accepted mentions as context."""
        spo_config = self._apply_stage_overrides(self._build_spo_config())

        # SPO uses an LLM client — label pack doesn't apply there, but we
        # still load it so the resolver signature is uniform.
        label_pack = self._load_label_pack()
        client = _resolve_client(self.spo_model, label_pack=label_pack)
        mcp_client = _build_mcp_client()
        pipeline = build_pipeline([spo_config], client, mcp_client)

        return self._run_pipeline(
            pipeline,
            chunks,
            code_location,
            upstream_mentions=accepted_mentions or [],
        )

    def extract_all(
        self,
        chunks: list,
        code_location: str = "",
    ) -> ExtractionResult:
        """Extract both NER + SPO in one call (backward compat)."""
        ner_config = self._apply_stage_overrides(self._build_ner_config())
        spo_config = self._apply_stage_overrides(self._build_spo_config())

        label_pack = self._load_label_pack()
        ner_client = _resolve_client(self.ner_model, label_pack=label_pack)
        spo_client = _resolve_client(self.spo_model, label_pack=label_pack)
        clients = {"ner": ner_client, "spo": spo_client}
        mcp_client = _build_mcp_client()

        pipeline = build_pipeline([ner_config, spo_config], clients, mcp_client)
        return self._run_pipeline(pipeline, chunks, code_location)

    def _run_pipeline(
        self,
        pipeline,
        chunks: list,
        code_location: str,
        ner_only: bool = False,
        upstream_mentions: list | None = None,
    ) -> ExtractionResult:
        """Run the pipeline across all chunks with concurrency."""
        from dagster_io.models import Assertion, Mention, MentionType, Provenance

        if not chunks:
            return ExtractionResult()

        all_mentions = []
        all_assertions = []
        all_audit_events = []
        total_mention_retries = 0
        total_proposition_retries = 0
        errors = 0

        start = time.monotonic()

        def _run_chunk(chunk) -> dict:
            loop = asyncio.new_event_loop()
            try:
                state: ExGraphState = {
                    "raw_text": chunk.text,
                    "source_metadata": {
                        "document_id": chunk.document_id,
                        "chunk_id": chunk.chunk_id,
                    },
                    "stages": {},
                    "upstream_context": {},
                    "audit_events": [],
                    "status": "pending",
                }
                if upstream_mentions is not None:
                    state["upstream_context"] = {
                        "accepted_mentions": [
                            m.model_dump(mode="json") if hasattr(m, "model_dump") else m for m in upstream_mentions
                        ],
                    }
                result = loop.run_until_complete(pipeline.ainvoke(state))
                legacy = pipeline_result_to_legacy(result)
                # Attach chunk metadata for provenance
                chunk_meta = getattr(chunk, "metadata", {}) or {}
                legacy["_chunk_metadata"] = chunk_meta
                legacy["_chunk_id"] = getattr(chunk, "chunk_id", "")
                return legacy
            finally:
                loop.close()

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as pool:
            futures = {pool.submit(_run_chunk, chunk): chunk for chunk in chunks}
            for future in as_completed(futures):
                result = future.result()
                chunk_meta = result.pop("_chunk_metadata", {})
                chunk_id = result.pop("_chunk_id", "")

                for m in result.get("accepted_mentions", []):
                    m["_chunk_metadata"] = chunk_meta
                    m["_chunk_id"] = chunk_id
                for a in result.get("accepted_propositions", []):
                    a["_chunk_metadata"] = chunk_meta
                    a["_chunk_id"] = chunk_id

                all_mentions.extend(result.get("accepted_mentions", []))
                all_assertions.extend(result.get("accepted_propositions", []))
                all_audit_events.extend(result.get("audit_events", []))
                total_mention_retries += result.get("mention_retry_count", 0)
                total_proposition_retries += result.get("proposition_retry_count", 0)
                if result.get("status") == "failed":
                    errors += 1

        duration = time.monotonic() - start

        # Convert to domain models
        mention_models = []
        for m in all_mentions:
            mention_type_str = m.get("mention_type", "OTHER")
            try:
                mention_type = MentionType(mention_type_str)
            except ValueError:
                mention_type = MentionType.OTHER

            chunk_meta = m.pop("_chunk_metadata", {})
            chunk_id_from_meta = m.pop("_chunk_id", "")
            prov = Provenance(
                source_document_id=m.get("document_id", ""),
                chunk_id=chunk_id_from_meta or m.get("chunk_id", ""),
                temporal_start_ms=int(chunk_meta["start_s"] * 1000) if chunk_meta.get("start_s") is not None else None,
                temporal_end_ms=int(chunk_meta["end_s"] * 1000) if chunk_meta.get("end_s") is not None else None,
                speaker_label=chunk_meta.get("speaker"),
                extraction_method="llm",
                extraction_model=self.ner_model if not all_assertions else self.spo_model,
                confidence=m.get("confidence", 1.0),
                code_location=code_location,
            )
            mention_models.append(
                Mention(
                    document_id=m.get("document_id", ""),
                    chunk_id=chunk_id_from_meta or m.get("chunk_id", ""),
                    text=m.get("text", ""),
                    mention_type=mention_type,
                    span_start=m.get("span_start"),
                    span_end=m.get("span_end"),
                    confidence=m.get("confidence", 1.0),
                    context=m.get("context", ""),
                    provenance=prov,
                )
            )

        assertion_models = []
        for a in all_assertions:
            chunk_meta = a.pop("_chunk_metadata", {})
            chunk_id_from_meta = a.pop("_chunk_id", "")
            a_prov = Provenance(
                source_document_id=a.get("document_id", ""),
                chunk_id=chunk_id_from_meta,
                temporal_start_ms=int(chunk_meta["start_s"] * 1000) if chunk_meta.get("start_s") is not None else None,
                temporal_end_ms=int(chunk_meta["end_s"] * 1000) if chunk_meta.get("end_s") is not None else None,
                speaker_label=chunk_meta.get("speaker"),
                extraction_method="llm",
                extraction_model=self.spo_model,
                code_location=code_location,
            )
            assertion_models.append(
                Assertion(
                    subject_text=a.get("subject", a.get("subject_text", "")),
                    predicate=a.get("predicate", ""),
                    object_text=a.get("object", a.get("object_text", "")),
                    confidence=a.get("confidence", 1.0),
                    negated=a.get("negated", False),
                    hedged=a.get("hedged", False),
                    qualifiers=a.get("qualifiers", {}),
                    provenance=a_prov,
                )
            )

        return ExtractionResult(
            mentions=mention_models,
            assertions=assertion_models,
            stats={
                "chunk_count": len(chunks),
                "duration_s": round(duration, 1),
                "mention_count": len(mention_models),
                "assertion_count": len(assertion_models),
                "mention_retries": total_mention_retries,
                "proposition_retries": total_proposition_retries,
                "errors": errors,
            },
            audit_events=all_audit_events,
        )
