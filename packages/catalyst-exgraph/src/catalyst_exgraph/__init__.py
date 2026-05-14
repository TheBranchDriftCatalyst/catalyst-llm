"""catalyst-exgraph: Generic composable extraction graphs.

Replaces the hardcoded NER→SPO pipeline in catalyst-langgraph-aio with
configurable extract→validate→repair stages that compose into pipelines.

Key features:
- Generic stage graph: one extract→validate→repair loop, parameterized by StageConfig
- Pipeline composition: chain stages (NER→SPO), per-stage model selection
- Ensemble extraction: N models → consensus voting
- Full provenance: every extraction tracks which model produced it
- ExtractionResource: Dagster ConfigurableResource with extract_mentions/extract_assertions
"""

from catalyst_exgraph.config import PipelineConfig, StageConfig, chunk_stage_config
from catalyst_exgraph.nodes.chunk import ChunkNode
from catalyst_exgraph.pipeline import build_pipeline
from catalyst_exgraph.protocol import ExtractionClient, ExtractionResult, StageResult
from catalyst_exgraph.stage import build_stage_graph
from catalyst_exgraph.state import ExGraphState, ExGraphStatus

# NOTE: `ExtractionResource` (Dagster ConfigurableResource) is NOT imported
# here — it pulls in the `dagster` package which is an optional extra
# (`pip install 'catalyst-exgraph[dagster]'`). Consumers that need the
# Dagster integration import it explicitly:
#
#     from catalyst_exgraph.resource import ExtractionResource
#
# Keeping it out of the package init means catalyst-langgraph (which
# only needs build_pipeline + config_schemas) can install
# catalyst-exgraph without dagster's heavy dep tree.

__all__ = [
    "ChunkNode",
    "ExGraphState",
    "ExGraphStatus",
    "ExtractionClient",
    "ExtractionResult",
    "PipelineConfig",
    "StageConfig",
    "StageResult",
    "build_pipeline",
    "build_stage_graph",
    "chunk_stage_config",
]
