# catalyst-exgraph

Generic composable extraction graphs with MCP validation, multi-voter
NER ensemble, AMR-as-spine proposition projection, and full provenance.

## What this is

The extraction-domain agent graph. Provides:

- **`build_pipeline()`** — chains configurable extract → validate →
  repair stages into a unified LangGraph StateGraph (legacy SPO path).
- **`build_ensemble_pipeline()`** — fan out across multiple NER
  encoders (GLiNER, NuExtract, UniversalNER, Regex) and reach
  consensus via `ConsensusNode` before downstream stages.
- **`AmrToAssertionNode`** — greenfield AMR-as-spine projection.
  Walks PENMAN graphs from `catalyst_langgraph.clients.amr_parser`,
  applies `pack.amr_frames` to map PropBank frames → canonical
  predicates, and emits `AmrAssertion` records with polarity,
  modality, qualifiers, and entity-ID provenance. See
  `examples/amr_congress_mvp.py` for an end-to-end demo.
- **`ExtractionResource`** — Dagster `ConfigurableResource` for
  embedding the pipeline inside catalyst-data code locations
  (congress-data, media-ingest, knowledge-graph, open-leaks).
  Accepts `prompt_dir` + `label_pack_id` so each code location
  pins its domain pack (see catalyst-langgraph for the
  `LabelPack` shape).
- **`ConsensusVoter`** — N-model ensemble majority voting with
  configurable strategies.
- **Models + validators** for the extraction-domain wire shapes
  (mentions, propositions, AMR assertions, spatial, math,
  concordance) — including the `Provenance` base type and the
  `MentionType` / `AlignmentType` / `ExtractionMethod` enums that
  the knowledge graph wires downstream consume.

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
├── models/               # extraction-output Pydantic shapes:
│   ├── extraction_output.py    # MentionCandidate, PropositionCandidate
│   ├── amr_assertion.py        # AmrAssertion (greenfield AMR-spine output)
│   ├── mentions.py             # MentionExtraction (validator I/O)
│   └── ...                     # spatial, math, concordance, repair
├── validators/           # contract validators (called from MCP server)
├── nodes/                # LangGraph node implementations:
│   ├── extract.py              # ExtractNode (legacy single-model SPO)
│   ├── ner_ensemble.py         # NerEnsembleNode (4-voter fan-out)
│   ├── consensus.py            # ConsensusNode (per-encoder mentions → canonical)
│   ├── amr_project.py          # AmrToAssertionNode (PENMAN → AmrAssertion)
│   ├── cluster.py, pack.py     # entity clustering + evidence packing
│   ├── repair.py, validate.py  # validator + repair-loop nodes
│   └── chunk.py, spans.py      # input prep + span correction
├── config.py             # StageConfig (incl. prompt_dir + label_pack_id)
├── state.py              # ExGraphState, status enums
├── protocol.py           # ExtractionClient protocol
├── stage.py              # build_stage_graph()
├── pipeline.py           # build_pipeline + build_ensemble_pipeline
├── resource.py           # ExtractionResource (Dagster)
├── ensemble.py           # EnsembleExtractNode, ConsensusVoter
└── consensus_predicate.py, consensus_taxonomy.py, dispatch.py
```

## Two extraction paths

### Legacy: NER ensemble → SPO LLM

```
chunk → NER ensemble (4 voters) → consensus → cluster → pack
                                                          → SPO LLM → validator → Assertion
```

Uses `proposition_extraction.prompt` to generate triples via a generative
LLM. Controlled-vocab predicates enforced by the validator.

### Greenfield: NER ensemble → AMR-as-spine

```
chunk → NER ensemble (4 voters) → consensus
                                  → AMR parser  (catalyst-langgraph.clients.amr_parser)
                                  → AmrToAssertionNode → AmrAssertion
```

AMR replaces the SPO LLM as the semantic spine. The projection node
reads `pack.amr_frames.frames` to map PropBank frames to canonical
predicates, applies `role_overrides` for non-standard argument
structures (e.g. passive-voice `refer-01`), and emits `AmrAssertion`
records with `polarity`, `modality`, `qualifiers`, and
`canonical_entity_refs` resolved against the NER consensus.

See `docs/reseearch/extraction-pipeline-gaps.md` for the design
context and `examples/amr_congress_mvp.py` for a working demo.

## Examples

- `examples/amr_congress_mvp.py` — end-to-end AMR-spine MVP on a
  hand-crafted congressional sentence with the real congress label
  pack + real RegexNerClient + real `AmrToAssertionNode`. Shows
  three assertions including a negated `report-01` ("the bill was
  never reported"). Run with `uv run python examples/amr_congress_mvp.py`.
