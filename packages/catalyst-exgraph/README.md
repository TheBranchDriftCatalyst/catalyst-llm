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
