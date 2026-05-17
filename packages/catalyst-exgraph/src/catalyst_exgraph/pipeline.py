"""Pipeline builders — compiled LangGraphs for the AMR-as-spine extraction.

Two builders, one architecture:

  * ``build_ensemble_pipeline`` — NER half only. Useful for callers that
    just want mentions + consensus + clustering, no AMR projection.

        [chunk →] ner_ensemble → consensus → cluster_entities → pack_evidence

  * ``build_amr_pipeline`` — the full greenfield path. Adds AMR parsing
    and projection on top of the ensemble output.

        [chunk →] ner_ensemble → consensus → cluster_entities → pack_evidence
                                            → amr_parse → amr_project

There is no SPO LLM stage. Predicates are projected deterministically
from PropBank frames via the active label pack's ``amr_frames`` table.
The legacy ``build_pipeline`` / ``build_spo_pipeline`` / ``build_ner_pipeline``
helpers + ``_StageRunner`` + ``pipeline_result_to_legacy`` were removed
when the AMR-as-spine refactor landed (roll-forward greenfield).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from dagster_io.chunking import ChunkConfig

from langgraph.graph import END, StateGraph

from catalyst_exgraph.config import StageConfig
from catalyst_exgraph.protocol import ExtractionClient
from catalyst_exgraph.state import ExGraphState


def build_ensemble_pipeline(  # noqa: PLR0913
    encoders: list[StageConfig],
    clients: dict[str, ExtractionClient],
    mcp_client: Any,
    embedder: Any = None,
    cache: Any = None,
    chunk_config: ChunkConfig | None = None,
    per_encoder_timeout_s: float = 60.0,
    quorum: int | None = None,
    per_type_quorum: dict[str, int] | None = None,
    predicate: Any = None,
) -> Any:
    """Build the NER-half pipeline.

    Graph: [chunk →] ner_ensemble → consensus → cluster_entities → pack_evidence

    Args:
        encoders: list of StageConfig — one per encoder model.
            ``cfg.model_override`` must match a key in ``clients``.
        clients: pre-resolved ExtractionClient instances keyed by encoder name.
        mcp_client: kept for the NerEnsembleNode signature; not invoked by
            the AMR path (no proposition validation needed).
        embedder: optional EmbeddingResource for ClusterEntitiesNode's
            embedding-merge step. ``None`` → proximity-only clustering.
        cache: optional EmbeddingCache. Defaults to a dict-backed fallback
            when dagster_io.embedding_cache isn't available.
        chunk_config: when set, prepends a ChunkNode.
        per_encoder_timeout_s: asyncio.wait_for timeout per encoder.
        quorum: override default ⌈N/2⌉ for ConsensusNode.
        per_type_quorum: per-type quorum overrides; ``None`` → PII_TYPES
            default to K=1.
        predicate: optional consensus expression for ConsensusNode.

    Returns:
        Compiled LangGraph ready for ``ainvoke()``.
    """
    from catalyst_exgraph.nodes.cluster import ClusterEntitiesNode
    from catalyst_exgraph.nodes.consensus import ConsensusNode
    from catalyst_exgraph.nodes.ner_ensemble import NerEnsembleNode
    from catalyst_exgraph.nodes.pack import PackEvidenceNode

    encoder_names = [cfg.model_override or cfg.stage_name for cfg in encoders]

    graph = StateGraph(ExGraphState)
    node_names: list[str] = []

    if chunk_config is not None:
        from catalyst_exgraph.nodes.chunk import ChunkNode

        graph.add_node("chunk", ChunkNode(chunk_config))
        node_names.append("chunk")

    graph.add_node(
        "ner_ensemble",
        NerEnsembleNode(
            encoders=encoders,
            clients=clients,
            mcp_client=mcp_client,
            per_encoder_timeout_s=per_encoder_timeout_s,
        ),
    )
    node_names.append("ner_ensemble")

    graph.add_node(
        "consensus",
        ConsensusNode(
            encoders=encoder_names,
            quorum=quorum,
            per_type_quorum=per_type_quorum,
            predicate=predicate,
        ),
    )
    node_names.append("consensus")

    graph.add_node("cluster_entities", ClusterEntitiesNode(embedder=embedder, cache=cache))
    node_names.append("cluster_entities")

    graph.add_node("pack_evidence", PackEvidenceNode())
    node_names.append("pack_evidence")

    graph.set_entry_point(node_names[0])
    for i in range(len(node_names) - 1):
        graph.add_edge(node_names[i], node_names[i + 1])
    graph.add_edge(node_names[-1], END)

    return graph.compile()


def build_amr_pipeline(  # noqa: PLR0913
    encoders: list[StageConfig],
    clients: dict[str, ExtractionClient],
    mcp_client: Any,
    amr_parser_client: Any,
    label_pack: Any,
    embedder: Any = None,
    cache: Any = None,
    chunk_config: ChunkConfig | None = None,
    per_encoder_timeout_s: float = 60.0,
    quorum: int | None = None,
    per_type_quorum: dict[str, int] | None = None,
    predicate: Any = None,
) -> Any:
    """Build the full AMR-as-spine extraction pipeline.

    Graph: [chunk →] ner_ensemble → consensus → cluster_entities → pack_evidence
                                  → amr_parse → amr_project

    The first half is identical to ``build_ensemble_pipeline``. The two
    AMR stages are appended sequentially after pack_evidence so the
    projection has consensus mentions available for entity-ref resolution.

    Args:
        encoders, clients, mcp_client, embedder, cache, chunk_config,
            per_encoder_timeout_s, quorum, per_type_quorum, predicate:
            same as ``build_ensemble_pipeline``.
        amr_parser_client: an ``AmrParserClient`` (or stub) — the seam
            that owns amrlib loading + sentence splitting. Caller picks
            so tests can inject a stub.
        label_pack: ``LabelPack`` with the ``amr_frames`` section populated.
            Both the NER encoders and the AMR projection read this.

    Returns:
        Compiled LangGraph ready for ``ainvoke()``.
    """
    from catalyst_exgraph.nodes.amr_parse import AmrParseNode
    from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
    from catalyst_exgraph.nodes.cluster import ClusterEntitiesNode
    from catalyst_exgraph.nodes.consensus import ConsensusNode
    from catalyst_exgraph.nodes.ner_ensemble import NerEnsembleNode
    from catalyst_exgraph.nodes.pack import PackEvidenceNode

    encoder_names = [cfg.model_override or cfg.stage_name for cfg in encoders]

    graph = StateGraph(ExGraphState)
    node_names: list[str] = []

    if chunk_config is not None:
        from catalyst_exgraph.nodes.chunk import ChunkNode

        graph.add_node("chunk", ChunkNode(chunk_config))
        node_names.append("chunk")

    graph.add_node(
        "ner_ensemble",
        NerEnsembleNode(
            encoders=encoders,
            clients=clients,
            mcp_client=mcp_client,
            per_encoder_timeout_s=per_encoder_timeout_s,
        ),
    )
    node_names.append("ner_ensemble")

    graph.add_node(
        "consensus",
        ConsensusNode(
            encoders=encoder_names,
            quorum=quorum,
            per_type_quorum=per_type_quorum,
            predicate=predicate,
        ),
    )
    node_names.append("consensus")

    graph.add_node("cluster_entities", ClusterEntitiesNode(embedder=embedder, cache=cache))
    node_names.append("cluster_entities")

    graph.add_node("pack_evidence", PackEvidenceNode())
    node_names.append("pack_evidence")

    graph.add_node("amr_parse", AmrParseNode(client=amr_parser_client))
    node_names.append("amr_parse")

    graph.add_node("amr_project", AmrToAssertionNode(label_pack=label_pack))
    node_names.append("amr_project")

    graph.set_entry_point(node_names[0])
    for i in range(len(node_names) - 1):
        graph.add_edge(node_names[i], node_names[i + 1])
    graph.add_edge(node_names[-1], END)

    return graph.compile()
