"""Per-node Pydantic config schemas for the extraction agent graph.

These are the canonical config models for the extract-validate-repair
pipeline. Used in two places:

1. **catalyst-langgraph Engine UI registration** — wrapped in an
   `AgentDescriptor` via `catalyst_langgraph.agents.extraction`, where
   each node's `config_model` points at one of these classes. The
   right-panel Config tab renders the JSON Schema for live tuning.

2. **catalyst-data Dagster code locations** — imported directly as
   asset / op config classes (`ConfigurableResource` consumes Pydantic
   BaseModels). The catalyst-data side gets the same per-node tunables
   without depending on the FastAPI server stack.

The `json_schema_extra={"agent_id": ..., "node_id": ...}` annotations
are catalyst-langgraph-specific routing metadata for the per-field
PATCH endpoint. Dagster ignores them — they're inert extra keys.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ───────────────────────────────────────────────────────────────────────
# Per-node config schemas — mirror catalyst-exgraph's StageConfig +
# helpers, pared down to what's editable in the Engine UI today.
# ───────────────────────────────────────────────────────────────────────


class ExtractionChunkConfig(BaseModel):
    """Tunables for the ``chunk`` node — deterministic windowed splitter
    that produces overlapping text chunks for downstream encoders."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "chunk"},
    }

    chunk_size: int = Field(
        default=512,
        ge=64,
        le=4096,
        title="Chunk size (tokens)",
        description="Maximum token count per chunk passed to the ensemble.",
        json_schema_extra={"ui": {"step": 32}},
    )
    chunk_overlap: int = Field(
        default=64,
        ge=0,
        le=512,
        title="Chunk overlap (tokens)",
        description="Tokens shared between adjacent chunks to preserve entity continuity.",
        json_schema_extra={"ui": {"step": 16}},
    )


class ExtractionNerEnsembleConfig(BaseModel):
    """Tunables for the ``ner_ensemble`` node — N encoder models run in
    parallel and emit per-encoder mention sets. The visual instance-stamp
    row on the node renders ``encoder_count`` sub-cards (Mixture-of-
    Experts style) driven by the live value of this field."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "ner_ensemble"},
    }

    encoder_count: int = Field(
        default=3,
        ge=1,
        le=8,
        title="Encoder count",
        description=(
            "Number of parallel encoder models in the ensemble. >1 enables "
            "consensus voting; 1 degenerates to single-encoder NER."
        ),
        json_schema_extra={"ui": {"step": 1}},
    )
    model: str = Field(
        default="gliner",
        title="Default encoder",
        description=(
            "Default encoder identifier (gliner / nuextract / etc). The "
            "runtime accepts per-encoder model overrides via "
            "catalyst-exgraph StageConfig.model_override."
        ),
    )
    per_encoder_timeout_s: float = Field(
        default=60.0,
        ge=1,
        le=600,
        title="Per-encoder timeout (s)",
        description="asyncio.wait_for cap per encoder. Stragglers are dropped without aborting the ensemble.",
        json_schema_extra={"ui": {"step": 5}},
    )


class ExtractionConsensusConfig(BaseModel):
    """Tunables for the ``consensus`` node — quorum vote over per-encoder
    mention sets, with a looser threshold for PII-typed mentions.

    Mirrors catalyst-data's ``catalyst_exgraph.ensemble.ConsensusVoter``
    shape (strategy + threshold) so the same operator intuition carries
    across the Dagster pipeline and this Engine view. The runtime
    converts threshold → quorum via ``ceil(strategy_threshold *
    encoder_count)`` at apply time.
    """

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "consensus"},
    }

    strategy: Literal["majority", "unanimous", "any"] = Field(
        default="majority",
        title="Strategy",
        description=(
            "Consensus voting strategy. `majority` accepts mentions seen "
            "by ≥ threshold·N encoders; `unanimous` requires all N to "
            "agree; `any` accepts any single encoder's call. Maps to "
            "catalyst-exgraph's ConsensusVoter.strategy."
        ),
    )
    threshold: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        title="Threshold",
        description=(
            "Fraction of encoders that must agree on a mention for it to "
            "pass under the `majority` strategy. Ignored by `unanimous` "
            "(forced to 1.0) and `any` (forced to >0). Maps to "
            "catalyst-exgraph's ConsensusVoter.threshold."
        ),
        json_schema_extra={"ui": {"step": 0.05}},
    )
    pii_threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        title="PII threshold",
        description=(
            "Looser threshold for PII-typed mentions — 0 accepts any "
            "single encoder's PII call, matching the safe default that a "
            "single hit on a PII mention should still flag it."
        ),
        json_schema_extra={"ui": {"step": 0.05}},
    )


class ExtractionClusterConfig(BaseModel):
    """Tunables for the ``cluster_entities`` node — merges near-duplicate
    mentions into canonical entities via embedding similarity + token
    proximity."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "cluster_entities"},
    }

    similarity_threshold: float = Field(
        default=0.85,
        ge=0,
        le=1,
        title="Similarity threshold",
        description="Cosine-similarity floor for embedding-merge. Mentions whose embeddings score above this are merged.",
        json_schema_extra={"ui": {"step": 0.01}},
    )
    embedder_model: str = Field(
        default="qwen3-embedding:8b",
        title="Embedder model",
        description="Embedding model id (resolves via the Engine's model picker when run locally).",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    proximity_window: int = Field(
        default=32,
        ge=0,
        le=512,
        title="Proximity window (chars)",
        description="Character distance under which two same-type mentions cluster regardless of embedding similarity. 0 disables proximity-only merging.",
        json_schema_extra={"ui": {"step": 8}},
    )


class ExtractionPackConfig(BaseModel):
    """Tunables for the ``pack_evidence`` node — windowed bundling of
    clustered mentions into evidence packets for the downstream SPO LLM."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "pack_evidence"},
    }

    window_size: int = Field(
        default=3,
        ge=1,
        le=10,
        title="Pack window size",
        description="Number of mentions bundled into one evidence packet sent to the SPO LLM.",
        json_schema_extra={"ui": {"step": 1}},
    )
    max_packs: int = Field(
        default=200,
        ge=1,
        le=2000,
        title="Max packs per doc",
        description="Hard cap on evidence packets per document. Prevents runaway SPO calls on long inputs.",
        json_schema_extra={"ui": {"step": 25}},
    )


DEFAULT_SPO_SYSTEM_PROMPT = (
    "You are a structured-extraction model. Given a packet of clustered "
    "entity mentions and the surrounding text, emit subject-predicate-"
    "object triples in strict JSON conforming to the spo.v1 contract.\n\n"
    "Hard rules:\n"
    "  - Each triple's subject_id and object_id MUST be one of the "
    "mention_ids in the packet — never invent new ids.\n"
    "  - The predicate string MUST be a canonical relation from the "
    "supplied taxonomy. If no taxonomy relation fits, use 'related_to' "
    "with a confidence ≤ 0.6.\n"
    "  - Include a per-triple confidence in [0, 1]. Be calibrated: 0.9+ "
    "means the relation is explicit in the text; 0.5 means inferred.\n"
    "  - When the text supports zero triples for a packet, emit an "
    "empty array — DO NOT hallucinate."
)


class ExtractionSpoConfig(BaseModel):
    """Tunables for the ``stage_spo`` node — the LLM call that emits
    subject-predicate-object triples for each evidence packet."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "stage_spo"},
    }

    model: str = Field(
        default="claude-haiku-4-5-20251001",
        title="Model",
        description="LLM the SPO extractor uses. Structured-output capable models score best.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    temperature: float = Field(
        default=0.2,
        ge=0,
        le=2,
        title="Temperature",
        description="Lower = more conservative relation extraction. >0.5 increases hallucination risk significantly.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    max_tokens: int = Field(
        default=2048,
        ge=64,
        le=32768,
        title="Max tokens",
        description="Response cap per packet. The JSON output is bounded by the packet's mention count × ~30 tokens.",
        json_schema_extra={"ui": {"step": 64}},
    )
    system_prompt: str = Field(
        default=DEFAULT_SPO_SYSTEM_PROMPT,
        title="System prompt",
        description="Instructions for the SPO extractor. The contract reference + hard rules live here.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )
    system_prompt_ref: str = Field(
        default="",
        title="System prompt ref",
        description="PromptStore id; resolved via request.prompt_overrides when set.",
        json_schema_extra={"ui": {"widget": "hidden"}},
    )


class ExtractionValidateSpoConfig(BaseModel):
    """Tunables for the ``validate_spo`` node — MCP contract validation
    of the SPO LLM's JSON output."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "validate_spo"},
    }

    contract_id: str = Field(
        default="spo.v1",
        title="Contract id",
        description="Versioned MCP contract identifier. Bump the version to break-change the SPO output shape.",
    )
    strict: bool = Field(
        default=True,
        title="Strict mode",
        description="When on, any contract violation routes to repair_spo. When off, violations are logged + dropped without a repair round.",
    )


DEFAULT_SPO_REPAIR_SYSTEM_PROMPT = (
    "You are a JSON-repair specialist. The previous SPO extractor output "
    "failed MCP contract validation. Re-emit a valid response conforming "
    "to the spo.v1 contract, addressing the specific validation errors "
    "supplied in the user message. Do NOT invent new triples; preserve "
    "the original subjects, predicates, and objects wherever possible, "
    "only fixing the structural / type issues called out."
)


class ExtractionRepairSpoConfig(BaseModel):
    """Tunables for the ``repair_spo`` node — LLM-based repair of
    contract-failing SPO output, loops back through validate_spo."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "repair_spo"},
    }

    model: str = Field(
        default="claude-haiku-4-5-20251001",
        title="Model",
        description="LLM the repair stage uses. Often a smaller / cheaper model than stage_spo since the work is purely structural.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    temperature: float = Field(
        default=0.1,
        ge=0,
        le=2,
        title="Temperature",
        description="Very low for repair — the goal is determinism, not creativity.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    max_tokens: int = Field(
        default=2048,
        ge=64,
        le=32768,
        title="Max tokens",
        description="Response cap. Typically smaller than stage_spo since repair edits an existing structure.",
        json_schema_extra={"ui": {"step": 64}},
    )
    max_repair_rounds: int = Field(
        default=2,
        ge=0,
        le=5,
        title="Max repair rounds",
        description="Hard cap on validate→repair iterations. 0 disables repair entirely (validation failures drop).",
        json_schema_extra={"ui": {"step": 1}},
    )
    system_prompt: str = Field(
        default=DEFAULT_SPO_REPAIR_SYSTEM_PROMPT,
        title="System prompt",
        description="Instructions for the repair stage. Should reinforce 'preserve, don't invent'.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )
    system_prompt_ref: str = Field(
        default="",
        title="System prompt ref",
        description="PromptStore id; resolved via request.prompt_overrides when set.",
        json_schema_extra={"ui": {"widget": "hidden"}},
    )

