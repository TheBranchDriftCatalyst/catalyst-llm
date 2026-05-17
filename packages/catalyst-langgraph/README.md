# catalyst-langgraph

LangGraph-based agent service for the Catalyst stack, plus the encoder
clients and label packs that drive the multi-voter NER ensemble + AMR
projection pipeline (see `catalyst-exgraph` for the orchestration layer).

Owns three concerns:

1. **Agent loop + tool dispatch** — graph nodes, event stream, FastAPI
   server (`graph.py`, `events.py`, `server.py`).
2. **Extraction clients** — adapters that wrap GLiNER / NuExtract /
   UniversalNER / Regex / AMR parser behind a uniform async interface
   so the same pipeline orchestrator can fan out to all of them.
3. **Label packs** — single-YAML domain configuration that drives all
   four NER voters + the AMR-frame projection from one file per domain.

## Layout

```
src/catalyst_langgraph/
├── client.py            CatalystLiteLLMClient (LiteLLM HTTP wrapper)
├── config.py            LiteLLMConfig (env + base URL)
├── prompts.py           .prompt registry loader (.prompt files w/ YAML frontmatter)
├── graph.py             StateGraph: model node ↔ tool node
├── events.py            Pydantic models for the SSE event union
├── server.py            FastAPI app
├── tools/host.py        httpx wrappers calling tool-host sidecar
│
├── clients/             ← extraction adapters (all expose structured_output()):
│   ├── llm.py            generic LLM client (OpenAI-style)
│   ├── gliner.py         GLiNER bi-encoder (zero-shot NER, ~300 MB)
│   ├── nuextract.py      NuExtract v1.5 / v2.0 (typed JSON template)
│   ├── universalner.py   UniNER-7B (conversational one-type-per-turn)
│   ├── regex_ner.py      deterministic 4th NER voter (format-validated IDs)
│   ├── amr_parser.py     AmrParserClient (PENMAN per sentence, async)
│   └── mcp.py            DirectMCPClient for in-process validators
│
└── label_packs/         ← domain-tailored prompt artifacts:
    ├── loader.py         LabelPack + AmrFrames + parsers
    ├── generic.labels.yaml  default pack (legacy hardcoded label set)
    └── pii.labels.yaml      gliner-pii model's PII-focused labels
```

## Label packs

A label pack is one YAML file expressing the same canonical entity
taxonomy in each ensemble voter's native idiom:

```yaml
# congress.labels.yaml — one file, five "prompts"
canonical_types: [PERSON, ORG, BILL, COMMITTEE_REF, ...]

gliner:                  # descriptive natural-language labels
  threshold: 0.3
  labels:
    "bill number such as H.R. 1234 or S. 567": BILL
    "U.S. congressional committee or subcommittee": COMMITTEE_REF

nuextract:               # typed JSON template (verbatim-string + enums)
  template:
    Bill:
      BillNumber: verbatim-string
      Sponsor: {Name: verbatim-string, State: verbatim-string, Party: [D, R, I]}
  canonical_type_map:
    "Bill.BillNumber": BILL
    "Bill.Sponsor.Name": PERSON

universalner:            # one chat per probe query, multi-probe per type
  queries:
    PERSON: ["senator", "representative", "member of Congress"]

regex:                   # deterministic 4th voter, conf=1.0
  patterns:
    BILL: ['\b(?:H\.R\.|S\.|H\.J\.Res\.)\s?\d{1,5}\b']
  authoritative_for: [BILL, PUBLIC_LAW, AMENDMENT]

amr_frames:              # PropBank frame → canonical predicate
  frames:
    introduce-01: sponsors
    refer-01:    refers_to
    vote-01:     voted_on
  extended_predicates: [voted_on, placed_on_calendar, ...]
  role_overrides:
    have-org-role-91: {ARG2: role_value}
    refer-01:         {ARG1: subject, ARG2: object}
```

**Resolution order**: callers pass `prompt_dir` + `pack_id` and the loader
looks for `<prompt_dir>/<pack_id>.labels.yaml` first, then falls back to
bundled packs (`generic`, `pii`) shipped inside this package.

Bundled packs at `src/catalyst_langgraph/label_packs/`. Domain packs live
in the consuming repo — for catalyst-data:

- `catalyst-data/k8s/congress-data/prompts/congress.labels.yaml` — 32
  GLiNER labels, nested NuExtract template, 25 UniNER probes, 15 regex
  patterns, 34 AMR frames mapped to legislative predicates.
- `catalyst-data/k8s/media-ingest/prompts/media.labels.yaml` — 29
  GLiNER labels, discourse-shaped NuExtract template, 25 UniNER probes,
  speaker-label regex authoritative, 66 AMR frames mapped to speech-act
  + action predicates with `ARG2 → source_attribution` overrides.

## AMR parser client

```python
from catalyst_langgraph.clients.amr_parser import AmrParserClient

client = AmrParserClient(sentence_splitter="spacy")
parses = await client.parse(chunk_text)
# parses: list[AmrSentenceParse(sentence_text, sentence_index,
#                                sentence_char_start, sentence_char_end,
#                                penman, parse_duration_s, parse_error)]
```

Sentence-isolation contract: each sentence parses independently; a single
bad sentence carries `parse_error` and `penman=""` instead of taking
down the whole chunk. Useful for legislative text where one runaway
"whereas" clause can choke the parser while the rest is fine.

Install the heavy parser separately — it's gated behind an optional dep:

```bash
pip install 'catalyst-langgraph[amr]'   # pulls in amrlib + ~500 MB checkpoint
```

The constructor never tries to import `amrlib`. The import is deferred to
the first `parse()` call, which raises `ImportError` with the install
command if the dep is missing.

**Splitter**: prefer `"spacy"` for production. The `"regex"` fallback
over-segments at abbreviation periods (`H.R.`, `S.`, `P.L.`, `U.S.C.`,
`Sen.`, `Dr.`) — fine for degraded mode, not for real bill text.

## Installation (dev)

```bash
cd packages/catalyst-langgraph
uv pip install -e ".[dev]"   # pulls in pytest, hypothesis, etc.
```

For AMR + property-based test support:

```bash
uv pip install -e ".[dev,amr]"
```

## Tests

```bash
uv run pytest tests/ --no-header -q
```

143 tests across encoder clients, label-pack loader, AMR parser, and
domain packs (congress + media-ingest + pii). See `tests/test_*.py` —
each domain pack has both a dev and a QA suite (`test_*_pack.py` +
`test_*_pack_qa.py`) implementing a 4-tier non-tautological strength
testing pyramid: adversarial unit, hypothesis property-based,
differential cross-validation, scenario.

## Configuration

```bash
export LITELLM_BASE_URL="http://litellm.talos00"
export LITELLM_API_KEY="sk-..."
# Encoder clients pick model checkpoints from env if not passed via pack:
export GLINER_MODEL="urchade/gliner_medium-v2.1"
export GLINER_THRESHOLD="0.3"
export LLM_BASE_URL="http://localhost:11434/v1"        # Ollama / litellm
export LLM_MODEL="nuextract:latest"
```

## See also

- `catalyst-exgraph` — pipeline orchestrator + AMR-to-assertion projection
  node + `ExtractionResource` Dagster resource.
- `catalyst-data/k8s/<domain>/prompts/` — domain label packs + `.prompt`
  files for the SPO/canonicalization LLM stages.

## License

MIT
