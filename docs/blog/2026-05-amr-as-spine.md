# From SPO Triples to AMR Graphs: Re-spining a Congressional Extraction Pipeline

*Why we ripped out the LLM-emits-triples extraction path that worked fine for a quarter, and what we replaced it with.*

---

## The sentence that broke us

Here is a perfectly ordinary sentence from a House status update:

> *"Rep. Smith introduced H.R. 1234, which was referred to the Committee on Energy and Commerce, but the bill was never reported."*

A reasonable person reading that sentence understands three things: Smith introduced the bill, the bill was referred to a committee, and the committee never reported it back out.

For about three months, our extraction pipeline read it like this:

```
(Rep. Smith,  sponsored,    H.R. 1234)
(H.R. 1234,   referred_to,  Committee on Energy and Commerce)
(H.R. 1234,   reported_by,  Committee on Energy and Commerce)
```

The third triple is wrong. It says the committee did report the bill. The word "never" — the load-bearing modifier of the third clause — has nowhere to go in a `(subject, predicate, object)` tuple. We had a `negated` boolean dangling off each triple, but the LLM emitting them never reliably set it on the third one. It almost always set it on the second, where it didn't belong, or on neither.

This is the kind of bug that doesn't surface in unit tests. It surfaces a quarter later when an analyst asks "did the Energy and Commerce Committee report H.R. 1234?" and the graph confidently says yes.

This post is about how we stopped having that bug. The short version: we moved the spine of our extraction pipeline from "ask an LLM for SPO triples" to "parse the sentence into an Abstract Meaning Representation graph, then deterministically walk the graph to emit assertions."

---

## A glossary, up front

- **SPO** — subject-predicate-object, the classic `(s, p, o)` triple. Lingua franca of RDF.
- **NER** — named entity recognition. Find spans like "Rep. Smith" or "H.R. 1234" and tag them with a type.
- **AMR** (Abstract Meaning Representation) — encode a whole sentence as a rooted directed graph of concepts and roles.
- **PENMAN** — human-readable text format for AMR graphs. Nested parenthesised S-expressions.
- **PropBank** — AMR's predicate inventory. Verbs become frames like `introduce-01`; the `-01`/`-02` suffix disambiguates senses, and each frame defines what `:ARG0`, `:ARG1`, etc. mean.
- **amrlib** — Python library wrapping a fine-tuned T5 parser. ~500MB of weights, 100ms–2s per sentence.
- **LabelPack** — our per-domain config object: NER labels, prompt templates, AMR frame mappings, consensus thresholds.

---

## Why we started with SPO

The original pipeline was a reasonable bet. We had four months of runway to get *something* into a graph database, and the cheapest extraction loop in 2025 is: chunk the source, prompt an LLM to emit subject-predicate-object triples as JSON, validate, write to the graph.

It works. It's fast to iterate on. We had bills, members, and committees showing up in Neo4j inside a week. The legacy `PropositionCandidate` model carried optional `negated` and `confidence` fields plus a free-form `qualifiers` dict for adjuncts. We told ourselves those would catch what flat SPO missed. They didn't.

Four structural problems killed it. **Negation under embedding**: *"The bill was never reported"* is one clause of a sentence whose main verb is "introduced" — the LLM reliably tagged the wrong clause as negated, or none. **Modality**: *"The Speaker may not entertain a request..."* stacks epistemic and negation modals; the LLM dropped one or garbled both. **Reentrancy**: the committee that didn't report the bill is the same committee the bill was referred to, but we emitted the string twice and depended on a downstream clustering pass to merge them — clustering is a probabilistic guess at coreference with its own error rate. **Conditionals**: *"If the President fails to return it with objections within 10 days while Congress is in session, it becomes law."* Try writing that as triples.

The pattern was familiar: a stakeholder spots a wrong triple, we add an example to the prompt, the prompt gets longer, the model starts misbehaving on previously-fine sentences. Eventually the prompt was 4,000 tokens and still wrong.

---

## What AMR gives you (and what it costs)

AMR encodes a sentence as a rooted directed graph. Nodes are concepts (`person`, `bill`) and predicates (`introduce-01`). Edges are normalised semantic roles — `:ARG0` is the doer, `:ARG1` is the thing-done-to, plus adjuncts for time (`:time`), place (`:location`), condition (`:condition`), manner (`:manner`), polarity (`:polarity`), and modality (`:mode`).

Our sentence parses to this PENMAN graph:

```penman
(i / introduce-01
   :ARG0 (p / person :name (n / name :op1 "Rep." :op2 "Smith"))
   :ARG1 (b / bill :name (n2 / name :op1 "H.R." :op2 "1234")
            :ARG1-of (r / refer-01
                        :ARG2 (c / committee
                                 :name (n3 / name :op1 "Committee" :op2 "on"
                                              :op3 "Energy" :op4 "and"
                                              :op5 "Commerce")))
            :ARG1-of (rep / report-01
                        :polarity -
                        :ARG0 c)))
```

Three things land for free that SPO had to fake:

**Polarity is a graph attribute.** `:polarity -` on the `report-01` node is unambiguous. No LLM is guessing a boolean.

**Reentrancy is one node, two references.** Variable `c` is the committee. It appears as the destination of `refer-01` and as the `:ARG0` of `report-01`. One committee node. Coreference solved by graph structure, not by a separate clustering pass that might get it wrong.

**Paraphrases collapse.** "Smith sponsored / introduced / was the primary sponsor of H.R. 1234" all parse to `introduce-01 :ARG0 Smith :ARG1 H.R. 1234`. PropBank already did the normalisation.

The cost is real. The amrlib model is ~500MB and runs as a separate microservice. Parsing is 100ms–2s per sentence. Parsers fail sometimes — a bad parse produces malformed PENMAN, which our projection skips with an audit event. PropBank's frame inventory has gaps; we handle those through per-domain frame tables.

The trade: spend the latency, eat the parser fragility, get a representation that can express negation, modality, conditionals, and coreference natively.

---

## The projection node

The bridge between "AMR graph" and "row in the gold layer" is one Python class: `AmrToAssertionNode` at `catalyst-llm/packages/catalyst-exgraph/src/catalyst_exgraph/nodes/amr_project.py`. It's a LangGraph node — async-callable, takes a state dict, returns a state-update dict.

The walk is deliberately boring. For every PENMAN string in `state["amr_parses"]`, decode with the `penman` library and iterate `graph.instances()`. The pattern `^[a-z][a-z-]*-\d+$` matches PropBank frames; bare nouns like `person` are skipped.

For each frame instance, the node:

1. Looks up the frame in the LabelPack's `amr_frames.frames` table to get the canonical predicate. `introduce-01 -> introduces`, `refer-01 -> refers_to`.
2. Reads `:polarity` and `:mode` off the predicate node's attributes.
3. Collects outgoing `:ARG*` edges and maps them through the pack's `role_overrides` to fill subject, object, or qualifier slots.
4. Collects `:time`, `:location`, `:condition`, `:manner` adjuncts as `qualifiers`.
5. Resolves each argument's surface form by walking `:name` edges and concatenating `:op1`/`:op2`/etc., falling back to the bare concept.
6. Matches resolved surfaces against the consensus NER mentions in the sentence's char window to attach `subject_mention_id` / `object_mention_id`.
7. Emits one `catalyst_contracts_core.Assertion` per frame.

The role mapping matters. PropBank's default is `ARG0 = subject, ARG1 = object`, but legislative text is full of passive constructions where that's wrong. *"The bill was referred to the Committee"* has the bill on ARG1 (referred thing) and the committee on ARG2 (destination); ARG0 (the referring agent) is silent. Defaulting to ARG0-as-subject yields an assertion with an empty subject. The congress pack overrides:

```yaml
role_overrides:
  refer-01:
    ARG1: subject       # the bill being referred
    ARG2: object        # the destination committee
  report-01:
    ARG0: subject       # the reporting committee
    ARG1: object        # the bill being reported
```

This is the knob the SPO prompt could never expose cleanly. Here it's nine lines of YAML.

Unknown frames are handled by a pack-level policy: `drop` (skip), `passthrough` (use the raw frame name), or `novel` (emit `NOVEL_<frame>` and flag `is_novel_predicate=True`). The congress pack uses `novel`. Unknown frames surface in review rather than silently disappearing into the graph.

A useful piece of bookkeeping: a frozen set of atemporal predicates gets `is_atemporal=True` stamped on the assertion. From `amr_project.py:88`:

```python
_ATEMPORAL_PREDICATES: frozenset[str] = frozenset({
    "cites", "references", "amends", "repeals",
    "supersedes", "codified_at",
})
```

The semantics: these are structural relationships between texts, not events. *"H.R. 1234 cites 5 U.S.C. § 552"* is true the moment the text is written and stays true forever. Point-in-time queries skip the temporal filter on these.

Every assertion gets a stable id — MD5 of `subject|predicate|object|chunk_id|sentence_index`, truncated to 16 hex. The structured path (below) uses the same recipe so the two streams dedup on the same hash.

There is no LLM in the projection. Once a sentence is parsed, the walk is fully deterministic and unit-testable. We have 82 tests across `test_amr_project.py`, `test_amr_project_qa.py`, `test_amr_project_step2_qa.py`, and `test_amr_pipeline_wiring.py` covering role overrides, polarity stamping, atemporal flagging, audit events, unknown-frame policies, and full-pipeline differential tests against hand-built PENMAN.

A runnable end-to-end demo lives at `catalyst-llm/packages/catalyst-exgraph/examples/amr_congress_mvp.py`. It runs the regex NER voter, stubs the AMR parser with the PENMAN above, and invokes the real `AmrToAssertionNode`. Output: three assertions — `introduces`, `refers_to`, and a negated `reported_by` — with the committee reentrancy preserved as a single referent and the negation on the right assertion.

---

## NER ensemble and consensus

AMR gives you predicate-argument structure. It does not give you a high-recall, type-tagged list of named entities. For that, four voters run in parallel and a consensus pass reconciles them.

The voters, configured per LabelPack:

- **GLiNER** (`knowledgator/gliner-bi-large-v1.0`) — bi-encoder that takes natural-language label descriptions like `"member of the U.S. Congress, a senator or representative"` and emits spans above threshold. Handles 20+ labels without major degradation.
- **NuExtract** (`numind/NuExtract-2.0-4B`) — small LLM tuned for typed-JSON extraction. We use it for pre-linked structured relations like sponsor + state + party in one shot.
- **UniversalNER** (`Universal-NER/UniNER-7B-all`) — 7B chat model handling one-type-per-turn queries.
- **Regex** — deterministic fourth voter. For format-validated identifiers (`H.R. 1234`, `P.L. 119-1`, `5 U.S.C. § 552`, `S.Amdt. 34`), regex is 100% precision and the model voters carry no information regex doesn't already have. Its votes carry `confidence=1.0`.

These run in parallel via `asyncio.gather` in `nodes/ner_ensemble.py`. Per-encoder timeouts (default 60s) isolate failures: a wedged voter gets its slot replaced with an empty list and an audit event; the ensemble continues with the survivors.

The consensus pass (`nodes/consensus.py`) canonicalises text and type, clusters mentions that share canonical text and have ≥50% span overlap via union-find, then votes on canonical type within each cluster. Quorum default is `K = ceil(N/2)`; per-type overrides exist (PII types default to `K=1` because only `gliner-pii` reliably finds them). Every accept and reject emits an audit event.

Why ensemble rather than pick the best single model? Coverage. Each voter has different recall on different entity types — GLiNER on descriptive labels, NuExtract on typed-JSON shapes, UniNER on subtype probes, regex on format-validated identifiers. The union, gated on vote count, has recall close to the union and precision close to the strongest individual voter.

One design choice worth flagging: the `canonical_type` field on the `Mention` model is a free-form `str`, not a Python `enum`. Each LabelPack defines its own type universe — the congress pack has 21 types (PERSON, ORG, BILL, COMMITTEE_REF, AMENDMENT, ROLL_CALL_VOTE, ...); the media pack has SPEAKER, STRATEGIC_ASSET, FINANCIAL_INSTRUMENT. If `canonical_type` were an enum, adding a domain would mean code changes. As a str, a new pack is a new YAML.

---

## Semantic chunking, per domain

Before NER and AMR run, the source has to be cut into chunks. There is no universal chunking strategy — what counts as a chunk depends on the source structure.

For bill text, naive character-window chunking is destructive. A definition in section 2 is referenced by name in sections 5, 12, and 19. Splitting mid-section orphans references. So `congress-data/src/congress_data/bill_chunker.py` does XML-aware section splitting. It parses GPO Formatted XML, walks `<section>`, `<subsection>`, `<paragraph>`, and `<quoted-block>`, and keeps whole sections intact as long as they fit under `MAX_CHUNK_CHARS = 4000`. Oversized sections split at subsection boundaries, grouping adjacent small subsections up to the cap. The last resort is `text_split_fallback` with the LangChain recursive splitter. Bills without XML fall through to a plain-text mode using regex patterns for `SECTION`, `TITLE`, `CHAPTER`, `PART` headers.

The media domain has the same problem in a different shape: a diarized podcast transcript has speaker turns, and splitting mid-turn orphans the second half of an argument from its speaker. Media chunking respects speaker boundaries and aggregates short turns. Open-leaks is the loosest: cables and document dumps split on `\n\n`.

All three emit the same `TextChunk` wire shape downstream. The chunking is upstream, polymorphic, and entirely a function of source structure. Everything past the chunker — NER, AMR, projection, concordance — treats them identically.

---

## Label packs as the domain knob

The same `AmrToAssertionNode` serves congress, media, and leaks. What changes is the LabelPack — a YAML file declaring the canonical type universe, one labels block per NER voter, the `amr_frames` table mapping PropBank frames to canonical predicates, a list of `extended_predicates` the AMR path exposes beyond the legacy prompt vocabulary, a `role_overrides` table, an `unknown_frame_action` policy, and consensus tuning.

The congress pack at `k8s/base/congress-data/prompts/congress.labels.yaml` maps 34 PropBank frames to canonical predicates and declares 16 extended predicates the AMR path exposes that the legacy prompt didn't have words for (`agreed_to`, `cites`, `codified_at`, `discharged_from`, `motion_to_recommit`, `override_succeeded`, `placed_on_calendar`, `presented_to_president`, `ranks_on`, `rejected`, `repeals`, `reported_by`, `struck_amendment`, `supersedes`, `voted_on`). The frame table is organised by legislative phase: sponsorship, legislative process, floor action, amendment, enactment, jurisdiction, citation.

The media pack at `k8s/base/media-ingest/prompts/media.labels.yaml` has a completely different frame table dominated by speech acts: `say-01 -> states`, `claim-01 -> claims`, `deny-01 -> denies`, `confirm-01 -> confirms`, `criticize-01 -> criticizes`. Its role overrides reflect speech-act argument structure: ARG0 is the speaker, ARG1 is the claim content, ARG2 is the source attribution that gets stuffed into a `source_attribution` qualifier rather than emitted as a separate triple.

Same projection node. Two YAML files. Two domains.

---

## Two converging streams: AMR + structured projection

There is a class of facts in congress data where running an LLM, an NER ensemble, and an AMR parser is wasteful. The Congress.gov API returns `Cosponsor` records that already carry `sponsorship_date` and `withdrawn_date` as typed fields. `Term` records carry `start_year` and `end_year`. `PublicLaw` records carry `signed_date`. These are not natural-language facts; they are structured rows. Asking an LLM to extract them is asking the wrong question.

So we built a second projection path. The deterministic converter at `catalyst-data/packages/congress-data/src/congress_data/assets/structured_assertions.py` takes a Pydantic model in and emits an `Assertion` out:

```python
def cosponsor_to_assertion(cosponsor: Cosponsor) -> Assertion:
    return Assertion(
        assertion_id=_assertion_id(...),
        subject_text=cosponsor.name or cosponsor.bioguide_id,
        predicate="co_sponsors",
        object_text=cosponsor.bill_id,
        t_valid_from=_iso(cosponsor.sponsorship_date),
        t_valid_until=_iso(cosponsor.withdrawn_date),
        polarity=cosponsor.withdrawn_date is None,
        ...
        provenance=_structured_provenance(...),
    )
```

The temporal validity window is stamped from source date fields. The `Provenance` is marked `ExtractionMethod.STRUCTURED` so downstream consumers distinguish it from `AMR_PROJECTION`. The `assertion_id` uses the same recipe as the AMR projection, so the two streams dedup on the same hash.

The two streams share a wire shape: `catalyst_contracts_core.Assertion`, at `catalyst-llm/packages/catalyst-contracts-core/src/catalyst_contracts_core/types.py`. It carries flat SPO for cheap exports; AMR provenance (`amr_frame`, `amr_variable`, `amr_role_mapping`, `is_novel_predicate`) when from a graph walk; `polarity` / `modality` / `negated` / `hedged` (the `negated` field is a legacy mirror kept in sync with `not polarity` by a post-validator); qualifiers as `dict[str, str]`; temporal validity (`t_valid_from`, `t_valid_until`, `is_atemporal`); geospatial placeholders; entity ref placeholders populated post-concordance; and `Provenance`.

The model is `frozen=True` and `extra="forbid"`. Assertions are emit-and-forget. Unknown fields are a contract leak and rejected at construction. The contracts package has 68 tests covering shape, enum values, and round-trip JSON. The shape is identical whether the assertion comes from AMR projection on a bill body, the structured converter for a Cosponsor row, or a future regex extraction. The bench harness reads the same bytes Dagster writes.

The `structured_assertions` module has 18 tests covering unit conversion, property invariants on temporal validity, and full point-in-time validity-window query scenarios (was member X a cosponsor of bill Y on date Z?). Because the window comes from source date fields rather than an LLM guess, those queries are answerable. With the old flat-SPO path, they weren't — the qualifier was a free-text string nothing parsed.

---

## The medallion architecture

The pipeline materialises through four layers: **Bronze** (raw API responses, podcast audio, cable text — stored as-is); **Silver** (parsed, chunked, normalised — `bill_chunks`, `member_terms`, `cosponsors`, diarized segments); **Gold** (extracted mentions and assertions per source — AMR projection on free-text chunks, structured converters on typed rows, both writing `Assertion` records); **Platinum** (cross-source concordance, canonical entities, the Statement graph in Neo4j with `SAME_AS` / `POSSIBLE_SAME_AS` alignment edges).

Bronze-to-Silver is per-domain. Silver-to-Gold has two parallel paths per domain. Gold-to-Platinum is shared — the concordance engine doesn't care whether a mention came from a bill body or a cable; it cares about `canonical_type` and surface text. The wire shape between every layer is the same `Assertion` and `Mention` types from `catalyst-contracts-core`. One wire format, multiple producers, multiple consumers.

---

## What's next

The AMR-as-spine path is the only extraction path in catalyst-exgraph today. The legacy SPO code was removed in commit `8218564` after `ff6ae46` cut over `ExtractionResource` to emit `contracts_core.Assertion`. No fallback. Maintaining two extraction paths in parallel was a tax we stopped paying once AMR passed its differential tests.

On the runway: parsing AMR `:time` adjuncts into ISO dates so the free-text path can stamp `t_valid_from` / `t_valid_until` the way structured converters already do; H3 geospatial grounding for GPE/LOC mentions (the `Assertion` model already carries `h3_cells` and `geometry_geojson` placeholders so the wire shape won't change when stamping ships); and an AMR complexity gate that runs the cheap NER+regex path first and only invokes AMR on sentences with negation/modality/conditional markers, for throughput.

---

## What we learned

**The wire shape is the spine.** A single `Assertion` Pydantic model, `frozen=True`, `extra="forbid"`, is what lets the pipeline have multiple producers (AMR projection, structured converter, eventually regex extraction) and multiple consumers (Dagster, Neo4j, the bench harness, the State Inspector) with a contract that breaks loudly when anyone sneaks in an unknown field. Get that shape right early.

**Don't let the LLM do the work the parser is built to do.** AMR parsers exist. They are slower and noisier than asking an LLM for JSON, but they get negation, modality, conditionals, reentrancy, and paraphrase normalisation right by construction. We were trying to teach an LLM to reproduce decades of computational linguistics from a prompt. We stopped.

**Let domains diverge in YAML, not in code.** The same projection node serves three domains because the only thing that changes is a LabelPack file. A fourth domain — climate filings, court opinions, scientific abstracts — is two files: a chunker that respects source structure and a pack with the right frame mappings.

**We shipped SPO first and we'd do it again.** Building AMR first would have meant six weeks of model wrangling before a single triple landed. The SPO path was wrong, but it was a working pipeline our stakeholders could poke at while we built the right thing underneath. The wrong thing in production is sometimes the right thing for the road map. Just don't fall in love with it.

The sentence at the top of this post still parses. The AMR pipeline emits three assertions: `(Rep. Smith, introduces, H.R. 1234)`, `(H.R. 1234, refers_to, Committee on Energy and Commerce)`, and `(Committee on Energy and Commerce, reported_by, H.R. 1234)` with `polarity=False` and `negated=True`. The committee appears once as a node, referenced twice. The negation is on the assertion that earned it. The graph means what the sentence said.
