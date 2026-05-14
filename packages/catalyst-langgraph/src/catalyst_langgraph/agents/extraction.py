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

from catalyst_exgraph.config_schemas import (
    ExtractionChunkConfig,
    ExtractionClusterConfig,
    ExtractionConsensusConfig,
    ExtractionNerEnsembleConfig,
    ExtractionPackConfig,
    ExtractionRepairSpoConfig,
    ExtractionSpoConfig,
    ExtractionValidateSpoConfig,
)

from . import (
    AgentDescriptor,
    AgentTopology,
    AgentTopologyEdge,
    AgentTopologyGroup,
    AgentTopologyNode,
    register_agent,
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
