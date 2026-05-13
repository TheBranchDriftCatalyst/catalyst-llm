"""Extraction agent registry — ports the topology of the NER-ensemble + SPO
extraction pipeline from ``catalyst-data/libs/catalyst-exgraph`` so the
Engine tab can visualise and tune its per-node configs.

This module **registers the topology only** — the actual extraction
runtime ships in ``catalyst-exgraph`` (NerEnsembleNode, ConsensusNode,
ClusterEntitiesNode, PackEvidenceNode, the SPO stage's
extract/validate/repair subgraph). Dispatching this agent via
``/api/chat/stream`` will fail because build_graph only knows the main
chat loop; the registration here is for **visualisation + per-node
config editing** in the Engine tab's LangGraphEnginePanel.

Source pipeline (catalyst-exgraph.pipeline.build_ensemble_pipeline +
build_spo_pipeline, chained):

    __start__
      └─ chunk             (deterministic chunker)
         └─ ner_ensemble   (N parallel encoders — ensemble group)
            └─ consensus   (quorum vote over per-encoder mentions)
               └─ cluster_entities  (embed + merge near-duplicate mentions)
                  └─ pack_evidence  (window-bundle mentions for SPO context)
                     └─ stage_spo   (LLM call — emit subject-predicate-object triples)
                        └─ validate_spo  (MCP contract check)
                           ├─ __end__         (if validation passes)
                           └─ repair_spo     (LLM repair, then back to validate)

The ensemble group_type on ner_ensemble means the topology renderer
stamps ``encoder_count`` member sub-cards inside the node (Mixture-of-
Experts style); the validate/repair loop demonstrates conditional
edges (dashed accent).
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from . import (
    AgentDescriptor,
    AgentTopology,
    AgentTopologyEdge,
    AgentTopologyGroup,
    AgentTopologyNode,
    register_agent,
)


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
    mention sets, with PII override handling."""

    model_config = {
        "extra": "ignore",
        "json_schema_extra": {"agent_id": "extraction", "node_id": "consensus"},
    }

    quorum: int = Field(
        default=2,
        ge=1,
        le=8,
        title="Quorum",
        description=(
            "Minimum encoders that must agree on a mention for it to pass. "
            "Default = ceil(encoder_count/2); set ≥ encoder_count for "
            "unanimity, set 1 to accept any encoder's call."
        ),
        json_schema_extra={"ui": {"step": 1}},
    )
    pii_quorum: int = Field(
        default=1,
        ge=1,
        le=8,
        title="PII quorum",
        description=(
            "Looser quorum for PII-typed mentions — typically 1 so a "
            "single encoder catching a PII mention is enough to flag it."
        ),
        json_schema_extra={"ui": {"step": 1}},
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


# ───────────────────────────────────────────────────────────────────────
# Registration
# ───────────────────────────────────────────────────────────────────────


register_agent(
    AgentDescriptor(
        id="extraction",
        description=(
            "NER ensemble + SPO extraction pipeline. Chunks input text, "
            "runs N encoders in parallel, consensus-votes mentions, "
            "clusters near-duplicates into canonical entities, packs "
            "evidence for the SPO LLM, then extracts subject-predicate-"
            "object triples with MCP contract validation + LLM repair. "
            "Topology mirrors catalyst-data/libs/catalyst-exgraph "
            "(build_ensemble_pipeline + build_spo_pipeline). The runtime "
            "ships in catalyst-exgraph; this registration is for "
            "Engine-tab visualisation + per-node config tuning."
        ),
        topology=AgentTopology(
            nodes=[
                AgentTopologyNode(id="__start__", type="start"),
                AgentTopologyNode(
                    id="chunk",
                    type="tools",
                    config_model=ExtractionChunkConfig,
                ),
                # ner_ensemble is the per-encoder TEMPLATE node — no
                # config_model of its own. The shared encoder config
                # (encoder_count, model, per_encoder_timeout_s) lives
                # on the `ner_ensemble_group` group below; the UI
                # stamps N encoder cards inside the container.
                AgentTopologyNode(
                    id="ner_ensemble",
                    type="agent",
                    group_id="ner_ensemble_group",
                ),
                AgentTopologyNode(
                    id="consensus",
                    type="tools",
                    config_model=ExtractionConsensusConfig,
                ),
                AgentTopologyNode(
                    id="cluster_entities",
                    type="tools",
                    config_model=ExtractionClusterConfig,
                ),
                AgentTopologyNode(
                    id="pack_evidence",
                    type="tools",
                    config_model=ExtractionPackConfig,
                ),
                # SPO stage's validate/repair loop is purely structural
                # (the conditional edges from validate_spo carry the
                # semantic). Dropping the actor_critic_loop wrapper
                # keeps the rendering simpler.
                AgentTopologyNode(
                    id="stage_spo",
                    type="agent",
                    config_model=ExtractionSpoConfig,
                ),
                AgentTopologyNode(
                    id="validate_spo",
                    type="tools",
                    config_model=ExtractionValidateSpoConfig,
                ),
                AgentTopologyNode(
                    id="repair_spo",
                    type="agent",
                    config_model=ExtractionRepairSpoConfig,
                ),
                AgentTopologyNode(id="__end__", type="end"),
            ],
            edges=[
                AgentTopologyEdge(source="__start__", target="chunk"),
                AgentTopologyEdge(source="chunk", target="ner_ensemble"),
                AgentTopologyEdge(source="ner_ensemble", target="consensus"),
                AgentTopologyEdge(source="consensus", target="cluster_entities"),
                AgentTopologyEdge(source="cluster_entities", target="pack_evidence"),
                AgentTopologyEdge(source="pack_evidence", target="stage_spo"),
                AgentTopologyEdge(source="stage_spo", target="validate_spo"),
                # Conditional: validation passes → end; fails → repair.
                AgentTopologyEdge(
                    source="validate_spo", target="__end__", conditional=True
                ),
                AgentTopologyEdge(
                    source="validate_spo", target="repair_spo", conditional=True
                ),
                # Repair loops back through validate.
                AgentTopologyEdge(source="repair_spo", target="validate_spo"),
            ],
            groups=[
                AgentTopologyGroup(
                    id="ner_ensemble_group",
                    type="ensemble",
                    config_model=ExtractionNerEnsembleConfig,
                    instance_count_field="encoder_count",
                    label="NER encoder ensemble",
                ),
            ],
        ),
    )
)
