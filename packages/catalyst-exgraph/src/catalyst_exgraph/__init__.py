"""catalyst-exgraph: AMR-as-spine composable extraction graphs.

Single-path extraction pipeline:

    chunk → NER ensemble (4 voters) → consensus → cluster → pack
                                                            → AMR parse
                                                            → AMR projection → AmrAssertion

NER candidates from GLiNER / NuExtract / UniversalNER / Regex flow into a
consensus voter; the consensus mentions anchor entity references for the
AMR-to-assertion projection. There is no SPO LLM stage — predicates are
projected deterministically from PropBank frames via the active label
pack's ``amr_frames`` table (see ``catalyst_langgraph.label_packs``).

Key entry points:
  * ``build_amr_pipeline()`` — compiled LangGraph for the full pipeline.
  * ``build_ensemble_pipeline()`` — NER-only half (no AMR projection).
  * ``ExtractionResource`` (Dagster) — the consumer-facing wrapper.

The legacy SPO LLM path (build_pipeline, build_spo_pipeline, EnsembleExtractNode,
proposition_validator, _SPO_CAPTURE_BUFFER) was removed when the AMR-as-spine
refactor landed. Roll-forward greenfield: no backward-compat shims.
"""

from catalyst_exgraph.config import StageConfig, chunk_stage_config, ner_stage_config
from catalyst_exgraph.nodes.chunk import ChunkNode
from catalyst_exgraph.pipeline import build_amr_pipeline, build_ensemble_pipeline
from catalyst_exgraph.protocol import ExtractionClient, ExtractionResult, StageResult
from catalyst_exgraph.state import ExGraphState, ExGraphStatus

# NOTE: `ExtractionResource` (Dagster ConfigurableResource) is NOT imported
# here — it pulls in the `dagster` package which is an optional extra
# (`pip install 'catalyst-exgraph[dagster]'`). Consumers that need the
# Dagster integration import it explicitly:
#
#     from catalyst_exgraph.resource import ExtractionResource

__all__ = [
    "ChunkNode",
    "ExGraphState",
    "ExGraphStatus",
    "ExtractionClient",
    "ExtractionResult",
    "StageConfig",
    "StageResult",
    "build_amr_pipeline",
    "build_ensemble_pipeline",
    "chunk_stage_config",
    "ner_stage_config",
]
