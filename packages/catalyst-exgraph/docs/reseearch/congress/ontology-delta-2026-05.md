# ONTOLOGY.md Delta — May 2026

This doc compares `catalyst-data/ONTOLOGY.md` (1170 lines, academic
prose) against what's actually shipping in `catalyst-llm` and
`catalyst-data` after the AMR-as-spine refactor (commits `5b2171c` …
`8218564` and the contracts-core unification on top).

Three sections:

1. **What's stale** — claims in the doc that point at deleted code or
   misname current shapes.
2. **What's missing** — concepts shipping today that the doc doesn't
   describe.
3. **Recommended rewrite plan** — section-by-section edit list, ordered
   by blast radius.

The theory chapters (§1–§17) are mostly evergreen and don't need
substantive edits. The damage is concentrated in §19
"Implementation cross-reference" (which was the bridge to code) and a
couple of object-model sketches in §10 + §12 that were drawn before
the unification landed.

---

## 1. What's stale

### 1.1 §19 cross-reference table — wrong type names

The table maps theory concepts to `catalyst_exgraph.models.*` and
`knowledge_graph.*` symbols. Most have moved.

| Doc says | Reality |
|---|---|
| `catalyst_exgraph.models.extraction_output.MentionCandidate` (raw NER) | ✅ still exists at that path. Fields trimmed to `text, mention_type, span_start, span_end, confidence` — no provenance on this transient type. |
| `catalyst_exgraph.consensus_taxonomy.ConsensusMention` (post-vote) | ❌ **absent**. The consensus stage emits dicts (see `nodes/consensus.py:244–258`) that `ExtractionResource` converts to `catalyst_contracts_core.Mention` before returning. |
| `catalyst_exgraph.models.amr_assertion.AmrAssertion` | ❌ **deleted** in commit `8218564 refactor: rip out dead SPO code`. Replaced by `catalyst_contracts_core.Assertion` (AMR-aware by default). |
| `catalyst_exgraph.models.extraction_output.PropositionCandidate` (legacy SPO) | ❌ **deleted**. SPO path is gone — no fallback, no parallel model. AMR projection is the single proposition source. |
| `Assertion` + `Provenance` lives "in `catalyst-data/packages/knowledge-graph/src/knowledge_graph/resources.py`" | ❌ moved. Both shapes are owned by `catalyst-contracts-core` (`packages/catalyst-contracts-core/src/catalyst_contracts_core/types.py`). `dagster_io.models` re-exports them; `knowledge_graph.resources` is the **consumer** (Neo4j writer), not the owner. |
| `knowledge_graph` package's `EntityCandidate` / `CanonicalEntity` | ⚠️ partly right — those classes live in `dagster-io/src/dagster_io/models.py`, not in the `knowledge_graph` package. The package contains the resolver logic; the wire shapes are in dagster_io. |

### 1.2 §10.1 object-model sketches — superseded by contracts-core

The "Entity node / Assertion node / Mention node" pseudocode in §10.1
is a generic sketch. The real shapes (now in `catalyst-contracts-core`)
have substantially more structure. The doc should either:

- replace the sketches with the **actual** Pydantic field lists; or
- frame the sketches explicitly as "minimum viable" and link out to
  the contracts-core source as the truth.

Specifically the doc's `Assertion` sketch omits: `amr_frame`,
`amr_variable`, `amr_role_mapping`, `polarity`, `modality`, `negated`,
`hedged`, `is_novel_predicate`, `t_valid_from`, `t_valid_until`,
`is_atemporal`, `h3_cells`, `geometry_geojson`, `sentence_index`,
`sentence_char_start`, `sentence_char_end`, `content_hash`. Each is a
real field today.

### 1.3 §5.3.1 ConcordanceEngine — still accurate, light verification needed

The 4-pass description (exact → substring → Jaccard → embedding) and
the multi-signal weighted-average scorer in CrossSourceAligner match
what's in `dagster_io.concordance` + the knowledge_graph package. No
changes needed — but the section should reference the actual file
paths so a reader can grep.

### 1.4 §19 "Greenfield pipeline" block — out of date wording

The fenced pseudocode block:

```
chunk text
  → NER ensemble (4 voters from LabelPack: GLiNER + NuExtract + UniNER + Regex)
  → ConsensusNode (per-encoder mentions → ConsensusMention list)
  → AmrParserClient.parse(chunk) → list[AmrSentenceParse]
  → AmrToAssertionNode (PENMAN walk + role_overrides + entity-ref resolution)
  → list[AmrAssertion]
  → Provenance stamping → Neo4j (Statement nodes) → on-demand RDF-star export
```

Two corrections:

- "→ list[AmrAssertion]" → **"→ list[catalyst_contracts_core.Assertion]"** (AmrAssertion is gone).
- "→ ConsensusMention list" → **"→ list[catalyst_contracts_core.Mention]"** (provenance, content_hash, canonical_entity_id all stamped at this stage).

A missing step in the chain: between ConsensusNode and AmrParserClient
there are now `ClusterNode` (entity proximity clustering) and
`PackNode` (evidence-window packing) — both feed AMR projection with
already-resolved entity references. See §2.2 below.

---

## 2. What's missing

These concepts/decisions are load-bearing today but aren't in the
current ONTOLOGY.md.

### 2.1 `catalyst-contracts-core` as the canonical wire-shape registry

The single most important architectural change since the doc was
written. Today:

- `catalyst-contracts-core` owns `Mention`, `Assertion`, `Provenance`,
  `MentionType`, `AlignmentType`, `ExtractionMethod`.
- `dagster_io.models` re-exports those + defines local-only types
  (`EntityCandidate`, `CanonicalEntity`, `AlignmentEdge`,
  `SpeakerProfile`, `SpeakerEmbedding`).
- `catalyst-exgraph` consumes contracts-core directly — `ExtractionResource.extract_assertions()`
  returns `ExtractionResult(mentions: list[Mention], assertions: list[Assertion])`,
  both `contracts_core` types.
- Bench harness reads the same Parquet schema from S3 that Dagster
  writes — one wire shape, no translation layer.

The doc should have a §0 or §1.5 "Shape ownership" section that names
contracts-core as the source of truth, with a one-line cross-reference
to where each shape lives.

### 2.2 The full AMR projection pipeline — five stages, not three

The doc's pipeline sketch jumps from NER → AMR parse → assertion.
Reality has two intermediate stages that materially shape the output:

| Stage | File | Purpose |
|---|---|---|
| 1. NER ensemble | `nodes/ner_ensemble.py` | Per-encoder NER (GLiNER + NuExtract + UniversalNER + Regex), audit-eventful |
| 2. Consensus | `nodes/consensus.py` | Per-encoder mentions → consensus dicts (vote_count, n_encoders, mean_confidence). Converted to `contracts_core.Mention` by `ExtractionResource`. |
| 3. **Cluster** | `nodes/cluster.py` | Group mentions by proximity + embedding cosine. Output drives entity-ref resolution in AMR projection. |
| 4. **Pack** | `nodes/pack.py` | Bin sentences + their consensus mentions into model-context windows ("EvidenceWindow") for AMR parsing. |
| 5. AMR parse | `nodes/amr_parse.py` (wraps `AmrParserClient`) | Sentence → PENMAN string. Returns `list[AmrSentenceParse]` (dataclass in catalyst-langgraph). |
| 6. AMR project | `nodes/amr_project.py` | PENMAN walk → `Assertion` with `amr_frame`, `amr_role_mapping`, `polarity`, `modality`, novel-predicate detection, entity-ref resolution. Emits `contracts_core.Assertion` directly. |

`EntityCluster` and `EvidenceWindow` are referenced in §10.1 of the
plan but **don't exist as Pydantic models** — they're internal dict
shapes inside `cluster.py` and `pack.py`. If the doc wants to call
them out, name them as "internal flows" rather than "wire shapes" or
they're misleading.

### 2.3 LabelPack as the per-domain configuration primitive

The doc mentions "labels" in §6 (schema induction) but doesn't name
the actual artifact. The `LabelPack` dataclass at
`catalyst-langgraph/src/catalyst_langgraph/label_packs/loader.py` is
**the** way a domain is configured. Top-level fields:

```python
LabelPack:
  name: str                    # pack identifier (e.g. "congress", "media")
  domain: str                  # human-readable domain tag
  description: str
  canonical_types: list[str]   # Tier-1 ontology (the doc's §6 split)
  gliner: GLiNERLabels         # NER labels for GLiNER encoder
  nuextract: NuExtractLabels   # NER template for NuExtract encoder
  universalner: UniversalNERLabels  # NER queries for UniNER encoder
  regex: RegexLabels           # regex fallback patterns
  amr_frames: AmrFrames        # PropBank frames + role overrides + extended predicates
  consensus: dict              # voting thresholds, type tie-breakers
```

Where `AmrFrames` sub-shape is:

```python
AmrFrames:
  frames: dict[str, FrameSpec]       # frame_id -> default role mapping
  unknown_frame_action: str          # "passthrough" | "novel" | "drop"
  role_overrides: dict[str, dict]    # per-frame ARG label overrides
  extended_predicates: frozenset[str]  # predicates only in AMR (not in SPO prompt)
```

In-tree packs today:
`catalyst-data/k8s/base/congress-data/prompts/congress.labels.yaml` and
`catalyst-data/k8s/base/media-ingest/prompts/media.labels.yaml`.

This is the §6 "Tier-1 core + Tier-2 induced" ontology split made
concrete. Open-leaks has prompts but no labels.yaml yet — relevant
gap to mention.

### 2.4 Novelty + polarity + modality as first-class assertion fields

The doc treats negation/modality as "qualifiers" (a generic dict).
Reality: they're typed top-level fields on `Assertion`, plus a
boolean for whether the predicate appears in the active label pack:

- `polarity: bool` — false = negated (from AMR `:polarity -`)
- `modality: str | None` — "possible" | "necessary" | "permissive" | ...
- `negated: bool` — convenience flag (mirrors `not polarity`)
- `hedged: bool` — set when an LLM downstream of AMR flags low certainty
- `is_novel_predicate: bool` — predicate isn't in the active LabelPack's `amr_frames.frames`

This matters because **§4.2's "SPO breaks on negation/modality"** is
no longer a problem you'd solve by adding qualifiers — it's solved by
the wire format itself. The doc should reflect that.

### 2.5 Temporal-validity + geospatial fields as placeholders

`Assertion` already carries `t_valid_from`, `t_valid_until`,
`is_atemporal`, `h3_cells`, `geometry_geojson`. None are stamped yet
(open beads: `llm-mln` for temporal, no bead for H3 geo). The doc
should call out: **fields landed, stamping is a follow-up** — so
contributors know not to add parallel fields when they wire the
stampers in.

### 2.6 Medallion layer mapping (bronze → silver → gold → platinum)

The doc's §9 architecture is layer-agnostic. The actual Dagster
pipeline runs on a medallion mapping that should be one table in
ONTOLOGY.md (or a sister doc — `PROJECTION_LAYERS.md` was in the
plan but not shipped). Sketch:

| LangGraph node | Dagster SDA | Layer | Wire shape | S3 prefix |
|---|---|---|---|---|
| (Congress.gov client) | `bill_documents` | bronze | `congress_data.entities.BillDetail` | `bronze/congress/bill_documents/` |
| `ChunkNode` | `bill_chunks` / `media_chunks` | silver | `dagster_io.TextChunk` | `silver/<domain>/chunks/` |
| `NerEnsembleNode` | (transient) | — | `dict[str, list[MentionCandidate]]` | not persisted |
| `ConsensusNode` | `bill_mentions` / `media_mentions` | gold | `contracts_core.Mention` | `gold/<domain>/mentions/` |
| `ClusterNode` + `PackNode` | (transient) | — | internal | not persisted |
| `AmrParseNode` | (transient OR `<domain>_amr_parses`) | — / gold-aux | `AmrSentenceParse` (penman) | `gold/<domain>/amr_parses/` |
| `AmrToAssertionNode` | `bill_assertions` / `media_assertions` | gold | `contracts_core.Assertion` | `gold/<domain>/assertions/` |
| `ConcordanceEngine` | `bill_entity_candidates` / `media_entity_candidates` | gold | `dagster_io.EntityCandidate` | `gold/<domain>/entity_candidates/` |
| `CrossSourceAligner` | `canonical_entities`, `alignment_edges` | platinum | `dagster_io.CanonicalEntity` + `AlignmentEdge` | `platinum/canonical_entities/` |
| (Neo4j writer) | `assertion_graph` | platinum | Neo4j Statement nodes + `:participates_in` edges | Neo4j primary |

### 2.7 ExtractionMethod enum values

Not in the doc, but worth pinning since they're stamped onto every
`Provenance`: `NER_ENSEMBLE, AMR_PROJECTION, LLM, SPACY, REGEX,
MANUAL, STRUCTURED`. These are the audit trail.

### 2.8 Resource boundary: `ExtractionResource`

The doc never names the actual Dagster-resource entry point. It's
`catalyst_exgraph.resource.ExtractionResource` with two methods:

- `extract_mentions(chunks)` — NER-only path (mentions, no assertions)
- `extract_assertions(chunks, code_location)` — full pipeline (mentions + assertions)

Both return `ExtractionResult` (dataclass at the same module) with
`mentions`, `assertions`, `stats`, `audit_events`, `pipeline_breakdown`.
This is what `dagster_io.extract_validated()` wraps — and what new
code locations should depend on.

### 2.9 Consensus dict shape (transient)

The dict that `ConsensusNode` emits before `ExtractionResource`
promotes it to `contracts_core.Mention`:

```
{mention_id, text, canonical_type, span_start, span_end,
 span_provenance, source_models, vote_count, n_encoders,
 mean_confidence, type_votes, raw_mentions}
```

Note `type_votes` (vote distribution by type) and `raw_mentions`
(cluster members for audit) **are dropped at promotion** — they exist
only in the transient dict. If we ever want them on the wire,
contracts-core has to grow the fields. Doc should mention this as a
deliberate gap (audit lives in `audit_events`, not in the Mention).

---

## 3. Recommended rewrite plan

Ordered by blast radius — small surgical edits first, structural adds
last.

### 3.1 Surgical fixes (≤30 LOC each, one PR)

- **§19 cross-reference table** — replace every `catalyst_exgraph.models.amr_assertion.*` and `ConsensusMention` row with `catalyst_contracts_core.*`. Drop the `PropositionCandidate` row. Re-point `EntityCandidate`/`CanonicalEntity` rows to `dagster_io.models`.
- **§19 pipeline block** — `AmrAssertion` → `Assertion`; `ConsensusMention` → `Mention`; add ClusterNode + PackNode steps.
- **§10.1 sketches** — add a one-line "actual shape: `catalyst_contracts_core.Assertion`" pointer under each sketch, or replace the sketches outright.
- **§4.3 qualified assertions** — note that negation/modality/polarity are typed fields, not generic qualifiers, in the current Assertion.

### 3.2 New sections (one each, can ship independently)

- **§0 or §1.5 "Shape ownership"** — one page. Who owns `Mention` / `Assertion` / `Provenance` (contracts-core). Re-export pattern in dagster_io. Why one shape across exgraph + dagster + bench.
- **§3.5 "AMR projection internals"** — what `AmrToAssertionNode` actually does. Polarity, modality, novel-predicate detection, role override resolution. Pseudocode for the PENMAN walk.
- **§5.5 "LabelPack as the configuration primitive"** — full schema, where they live in tree, how a new domain adds a pack.
- **§9.10 or new §10b "Medallion mapping"** — the LangGraph node ↔ Dagster SDA ↔ S3 prefix table from §2.6 above. Could live as a sister doc (`PROJECTION_LAYERS.md`) if you don't want to grow ONTOLOGY.md.
- **§7.6 "Temporal + geospatial fields shipped, stampers pending"** — explicit "field landed, stamper bead `llm-mln` open" notes for `t_valid_from/until` + H3 grounding, so contributors don't double-build.

### 3.3 Sections to leave alone

- §1–§4 (theory: open IE, SRL, AMR, RDF-star) — evergreen, still correct.
- §6 (schema induction) — direction still right; the LabelPack section above operationalises it.
- §7 (spatial grounding theory) — evergreen.
- §8 (diffusion techniques) — evergreen.
- §11 (mathematical formulation) — evergreen.
- §12–§16 (data model recommendations, eval, failure modes) — evergreen.
- §17 (recommended pipeline) — directional, still correct.

### 3.4 Open question

Two options for the final shape:

- **Option A**: keep ONTOLOGY.md as the single big doc, do the surgical
  fixes + the new sections in place. Doc grows to ~1300 lines.
- **Option B**: split. Keep ONTOLOGY.md as the theory/architecture
  paper; lift "§19 cross-reference" + the LabelPack + medallion
  sections into a sister `IMPLEMENTATION.md` that tracks code more
  aggressively. Theory ages well, implementation ages fast — easier to
  keep them in step if they're separate.

I'd recommend **B**. The theory chapters are good enough to publish;
the implementation cross-ref needs to be churned every refactor and
that pace doesn't match the rest of the doc.
