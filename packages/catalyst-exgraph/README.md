# catalyst-exgraph

Generic composable extraction graphs with MCP validation, ensemble
support, and full provenance.

## What this is

The extraction-domain agent graph. Provides:

- **`build_pipeline()`** — chains configurable extract → validate →
  repair stages into a unified LangGraph StateGraph.
- **`ExtractionResource`** — Dagster `ConfigurableResource` for
  embedding the pipeline inside catalyst-data code locations
  (congress-data, media-ingest, knowledge-graph, open-leaks).
- **`ConsensusVoter`** — N-model ensemble majority voting with
  configurable strategies.
- **Models + validators** for the extraction-domain wire shapes
  (mentions, propositions, spatial, math, concordance) — including
  the `Provenance` base type and the `MentionType` / `AlignmentType`
  / `ExtractionMethod` enums that the knowledge graph wires
  downstream consume.

## What this is NOT

- Not a topology-annotated agent. The topology metadata that drives
  the Engine UI lives in `catalyst-langgraph/src/catalyst_langgraph/
  agents/extraction.py`, which imports `build_pipeline()` from here
  and adds the `AgentDescriptor` wrapping.
- Not a server. The MCP validation server is a separate package
  (`catalyst-contracts-mcp`); it imports our validators.

## Consumers

| Consumer | What it pulls in |
|---|---|
| `catalyst-langgraph` (FastAPI server) | `build_pipeline`, types, models. Wraps it with topology metadata. |
| `catalyst-data/packages/{congress-data,media-ingest,knowledge-graph,open-leaks}` | `ExtractionResource` (via the `dagster` extra). |
| `catalyst-contracts-mcp` (MCP service) | `validators/*` for the 7 MCP tools. |

## Integration

### catalyst-langgraph (this monorepo, FastAPI server)

Already wired. `catalyst_langgraph/agents/extraction.py` imports the
per-node config_schemas + the topology metadata and registers an
`AgentDescriptor`. `GET /api/agents` exposes it; the Engine UI in the
playground renders + tunes its per-node configs live.

Runtime dispatch via `POST /api/agents/extraction/stream` returns 501
today — tracked under bd `llm-vfx`. When that lands the server will
import `catalyst_exgraph.pipeline.build_pipeline` and dispatch with
the operator's per-node config overrides.

### catalyst-data codespaces (separate repo, Dagster code locations)

Each of the 4 codespaces (`congress-data`, `media-ingest`,
`knowledge-graph`, `open-leaks`) should add path-source deps:

```toml
# catalyst-data/packages/<codespace>/pyproject.toml

[project]
dependencies = [
    "dagster>=1.13",
    "dagster-io",                  # existing
    "catalyst-exgraph",            # NEW — pipeline + types + validators
    "catalyst-contracts-core",     # NEW — MentionType, AlignmentType, Provenance
]

[tool.uv.sources]
catalyst-exgraph        = { path = "../../../../catalyst-llm/packages/catalyst-exgraph" }
catalyst-contracts-core = { path = "../../../../catalyst-llm/packages/catalyst-contracts-core" }
```

Then in the codespace's definitions:

```python
from catalyst_exgraph import ExtractionResource
from catalyst_exgraph.config_schemas import ExtractionChunkConfig

resources = {"extraction": ExtractionResource(...)}
```

This wiring is tracked under bd `llm-le1` — a cross-repo follow-up
to the llm-tqo consolidation that landed in catalyst-llm.

### catalyst-contracts-mcp (this monorepo, optional MCP service)

Standalone. Imports `catalyst_exgraph.validators.*` and exposes them
as MCP tools. Dev work doesn't need it running — exgraph pipelines
call the validators in-process. The MCP server is for OUTSIDE
consumers (Claude Code, third-party LLMs).

## Layout

```
src/catalyst_exgraph/
├── types.py              # MentionType, AlignmentType, ExtractionMethod
├── provenance.py         # Provenance base type
├── models/               # extraction-output Pydantic shapes
├── validators/           # contract validators
├── nodes/                # 12 LangGraph node implementations
├── config.py, state.py, protocol.py
├── stage.py              # build_stage_graph()
├── pipeline.py           # build_pipeline()
├── resource.py           # Dagster ConfigurableResource
├── ensemble.py           # EnsembleExtractNode, ConsensusVoter
└── consensus_predicate.py, consensus_taxonomy.py, dispatch.py
```
