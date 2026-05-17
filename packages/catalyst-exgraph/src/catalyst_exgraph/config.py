"""Extraction stage configuration.

``StageConfig`` parameterizes one NER stage (single encoder or ensemble).
The legacy SPO stage + multi-stage ``PipelineConfig`` were removed when
the AMR-as-spine refactor landed — the AMR pipeline composes nodes
directly in ``build_amr_pipeline`` instead of running a generic
extract→validate→repair loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from dagster_io.chunking import ChunkConfig


@dataclass(frozen=True)
class StageConfig:
    """Configuration for one NER extraction stage.

    Each stage runs: extract → validate → repair(loop) for one extraction type.
    The stage is parameterized by the Pydantic output schema, prompt IDs, and
    the MCP validation tool name.
    """

    stage_name: str
    """Unique name for this stage (e.g. 'ner', 'spo'). Used as key in ExGraphState.stages."""

    extraction_schema: type[BaseModel]
    """Pydantic model for structured LLM output (e.g. MentionExtractionResult)."""

    prompt_id: str
    """Prompt registry ID for extraction (e.g. 'mention_extraction')."""

    validation_tool: str
    """MCP validator tool name (e.g. 'validate_mentions')."""

    repair_prompt_id: str
    """Prompt registry ID for repair (e.g. 'mention_repair')."""

    fallback_prompt: str = ""
    """Fallback prompt text when prompt registry file is missing."""

    fallback_repair_prompt: str = ""
    """Fallback repair prompt text."""

    prompt_dir: str | None = None
    """Directory containing .prompt files. Overrides PROMPT_REGISTRY_DIR env var.
    Set per-stage or per-resource to use domain-specific prompts
    (e.g. k8s/media-ingest/prompts vs k8s/congress-data/prompts)."""

    label_pack_id: str | None = None
    """Label pack id resolved against prompt_dir then catalyst-langgraph's
    bundled packs (generic, pii). Drives the per-encoder prompt vocabulary
    (GLiNER labels, NuExtract template, UniversalNER queries, regex patterns).
    When None, each encoder client falls back to the bundled 'generic' pack."""

    max_retries: int = 3
    """Max repair cycles. Set to 0 for encoder models (deterministic output)."""

    model_override: str | None = None
    """Override LLM_MODEL env var for this stage (enables per-stage model selection)."""

    skip: bool = False
    """Skip this stage entirely (pass-through)."""

    # Phase 4: Ensemble
    ensemble_models: list[str] | None = None
    """List of model names for ensemble extraction. None = single model."""

    consensus_strategy: str = "majority"
    """Ensemble voting strategy: 'majority', 'unanimous', or 'any'."""

    consensus_threshold: float = 0.5
    """Minimum fraction of models that must agree for consensus."""


# ── Preset configs ────────────────────────────────────────────────────


def ner_stage_config(
    model: str | None = None,
    max_retries: int = 0,
    ensemble_models: list[str] | None = None,
) -> StageConfig:
    """Create a NER (mention extraction) stage config.

    Default ``max_retries=0`` matches encoder behaviour (deterministic
    output; no repair loop). Set higher only if you're running an
    LLM-backed NER model that benefits from validate/repair cycles —
    but the AMR-as-spine path uses the encoder ensemble, so 0 is correct.
    """
    from catalyst_exgraph.models.extraction_output import MentionExtractionResult

    return StageConfig(
        stage_name="ner",
        extraction_schema=MentionExtractionResult,
        prompt_id="mention_extraction",
        validation_tool="validate_mentions",
        repair_prompt_id="mention_repair",
        max_retries=max_retries,
        model_override=model,
        ensemble_models=ensemble_models,
    )


def chunk_stage_config(strategy: str = "recursive", **overrides) -> ChunkConfig:
    """Create a ChunkConfig with sensible defaults for pipeline chunking.

    Args:
        strategy: Chunking strategy ('recursive', 'section', 'speaker', 'passthrough').
        **overrides: Any ChunkConfig field overrides (e.g. model_context_tokens=128000).

    Returns:
        ChunkConfig ready to pass to build_amr_pipeline() / build_ensemble_pipeline().
    """
    from dagster_io.chunking import ChunkConfig

    return ChunkConfig(strategy=strategy, **overrides)


