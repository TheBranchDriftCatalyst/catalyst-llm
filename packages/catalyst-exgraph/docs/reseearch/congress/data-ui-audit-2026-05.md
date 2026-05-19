# catalyst-data-ui Audit Report (post-AMR-as-spine backend refactor)

**Date:** 2026-05-19
**Scope:** `/Users/panda/catalyst-devspace/workspace/catalyst-data/packages/catalyst-data-ui/`
**Backend refactor cluster:** commits `6b78435`, `6e17418`, `76ed462`, `e4421d8`, `759cfd2`, `92b380b`, `8a78676`, `ce55fd5`, `d1f5e08`, `1439bf0`
**Reviewer:** investigation only — no code changed.

---

## A. Surface area inventory

The SPA is a single Vite + React 19 app, **not** split per-domain. There is no `viewer-ui` directory inside `media-ingest` anymore — the only ones that turn up via filesystem search are the build artifacts under `catalyst-data-ui/dist/`. `catalyst-data-ui` *is* the unified SPA the workspace ships today.

- **Framework:** Vite 6 + React 19 + react-router-dom 7 (basename `/viewer`). `package.json` is hand-rolled, no codegen scripts. Tailwind v4 via `@tailwindcss/vite`.
- **State / data fetching:** `@tanstack/react-query` v5 is the cache; no Redux/Zustand/Context store of substance. All server calls funnel through `src/api/client.ts`, which is a thin `fetch(API_BASE+path)` wrapper around the FastAPI viewer mounted at `/viewer/api/*`. There is no tRPC, no GraphQL, no openapi-typescript codegen — every wire type is hand-typed in `src/types/*.ts`.
- **Routing (App.tsx):**
  - `/` → redirect to `/documents/media`
  - `/documents/:domain` → `Documents` shell (registry-driven sub-tabs from `GET /viewer/api/domains`)
  - `/documents/:domain/:id` → generic `DomainDocumentDetail` (used by `congress` + `leaks` — media-ingest goes to the player instead)
  - `/player/:documentId` → media-ingest's `PlayerPage` (transcript + speakers + mentions + assertions panels)
  - `/s3` → `S3Explorer`
  - `/benchmarks`, `/benchmarks/state`, `/benchmarks/runner` → BenchmarkReport, StateInspector, BenchmarkRunner
- **Sidebar:** rendered only on `/documents/media` and `/player/*` — explicitly noted in App.tsx as "inherently media-ingest-specific."

The visible surface is **one unified SPA with three first-class domain experiences** (media gets the full player; congress + leaks share a generic JSON-tree detail page). The backend is the per-domain router factory in `media-ingest/.../viewer/routes/documents_factory.py` — the FastAPI app itself still lives inside the media-ingest package (legacy mount).

---

## B. Type-shape audit

The canonical Python wire shape is now `catalyst_contracts_core.types.{Provenance,Mention,Assertion}` — `frozen=True`, `extra="forbid"`, AMR-rich. The TS side has not been touched.

### `src/types/media.ts`

- **L79–88 `Mention`** ⚠️ **Breaking.**
  Has only `{ text, mention_type, context, span_start, span_end, document_id, chunk_id, provenance? }`. The new Python shape carries `mention_id`, `canonical_type` (free-form, replaces the `mention_type` enum), `vote_count`, `n_encoders`, `source_models`, `mean_confidence`, `span_provenance`, `canonical_entity_id`, `content_hash` — **none of these surface here**. Worse, the field name `mention_type` no longer matches what comes off the wire: the backend writes `canonical_type`. JSON.parse will yield `undefined` for every existing mention-type read in the UI (and the UI reads it a *lot* — at least 18 callsites, see grep below).
  Also note `provenance` is optional here but **mandatory** on the new contract — defensive code is fine, but the type permissiveness hides a class of bugs where the UI assumes "no provenance" is normal.

- **L90–102 `Provenance`** ⚠️ **Mostly compatible but stale.**
  Misses `timestamp` (auto-stamped), `code_location` (always present on new contract). `extraction_method` is typed as `string` here, but the backend now emits one of a fixed StrEnum: `llm | spacy | regex | manual | structured | amr_projection | ner_ensemble`. There is **no UI today that branches on `extraction_method`** (the field is unread by every component) — so the structured-vs-AMR provenance distinction the platinum-layer cares about is invisible in every panel.

- **L104–115 `Assertion`** ⚠️ **Breaking in spirit, compiles by coincidence.**
  Has the legacy flat SPO shape: `{ assertion_id?, subject_text, predicate, predicate_canonical, object_text, confidence, negated, hedged, qualifiers, provenance? }`.
  - `predicate_canonical` (used in `AssertionPanel.tsx:78` to sort) **does not exist** on the new contract — `predicate` is *already* canonical (label-pack vocab). The sort will silently fall back to `undefined.localeCompare(undefined)`-style runtime errors when real AMR rows land.
  - `object_text` is now `string | null` (intransitives like `pass-03` with only ARG1). `AssertionCard.tsx:73` renders it unconditionally — will print "null" or blank for every intransitive.
  - `assertion_id` is now **required** (a stable hash). `AssertionPanel.tsx:27` still synthesizes a synthetic id when it's missing — dead branch.
  - Missing entirely from the TS type:
    `subject_entity_id`, `object_entity_id`, `subject_mention_id`, `object_mention_id`,
    `amr_frame`, `amr_variable`, `amr_role_mapping`, `is_novel_predicate`,
    `polarity`, `modality`,
    `t_valid_from`, `t_valid_until`, `is_atemporal`,
    `h3_cells`, `geometry_geojson`,
    `sentence_index`, `sentence_char_start`, `sentence_char_end`,
    `content_hash`.
  - `qualifiers: Record<string, string>` is correct — the contract is now typed-dict (`dict[str, str]`), so the existing type accidentally matches.

### `src/types/document.ts`
✅ **Compatible.** The `Document` shape (`id, title, source, source_path, document_type?, domain, ingested_at?, metadata`) is the silver-row dict the backend returns from `DocumentsService.list_documents`; nothing on the contracts-core refactor touched this layer. Same for `Domain` (registry response).

### `src/types/benchmark.ts`
- **L235 `GroundTruthMention`** ⚠️ uses `mention_type` field name. The GT files on disk still call this `mention_type` (per `GroundTruthPanel.tsx`) so this is actually compatible with the GT-editor wire — but it does **not** match the gold-layer assertion-stream Mention shape. Two different "mentions" in the codebase under the same name.
- **L309, L319, L343 (consensus event details)** ✅ Already use `canonical_type / vote_count / n_encoders / source_models / mean_confidence` — these were updated for the consensus / Gap #9 work and happen to match the new contracts-core fields exactly. The `StateInspector` + `ConsensusDetail` are the only UI surfaces that already speak the new Mention vocabulary.

### `src/types/annotations.ts`
✅ **Compatible.** Annotation contract is independent of the assertion/mention shapes (just `target_id` + `action` + `edits`).

### Net: the wire-shape gap is concentrated in **`src/types/media.ts`** (the legacy media-ingest dump). That single file is the load-bearing artifact.

---

## C. Data-fetching audit

- **S3 explorer endpoint shape** — single source, `src/api/client.ts:fetchS3List / fetchS3Read / fetchS3Search / fetchS3FolderStats` calling `GET /viewer/api/s3/*`. Backend handler is `media_ingest/viewer/routes/s3_explorer.py`. Not split per domain. Works against any prefix, so `silver/congress_data/...`, `gold/congress_data/congress/congress_structured_assertions/...`, `bronze/congress_data/bill/...` are all reachable by the explorer with no client-side change needed.
- **Bench audit log** — `src/hooks/useRunStream.ts`, `useRunReport.ts`, `useRunIndex.ts`, `useRuns.ts`, and the entire `src/components/benchmark/` + `src/components/state/` folders consume the `RunEvent` NDJSON from `GET /viewer/api/bench/runs/<id>/events` (the `dagster_io.bench` audit log). The shape (`src/types/benchmark.ts:RunEvent`) is current as of the consensus / Gap #9 work and lines up with what `dagster_io.bench` emits.
- **Neo4j** — **zero references in the SPA.** No `neo4j`, `cypher`, `Statement`, or `graphdb` strings anywhere in `src/`. The platinum-layer `assertion_graph` is Neo4j-resident (per `76ed462`) and **completely invisible to the UI today**. There is no graph viewer, no Cypher console, no Statement-node detail view — even though `@xyflow/react` and `@dagrejs/dagre` are already in `package.json` (used today only by `PipelineGraph.tsx` for the run-state DAG).
- **Gold paths** — the legacy media S3 paths in `s3_data.py` (`gold/<location>/media/<asset>/`) are correct for media-ingest. The new **per-domain gold paths** the backend writes (`gold/congress_data/bill/{bill_chunks,bill_document,bill_mentions,bill_assertions}/<partition>/data.jsonl`) and the **new bill-partitioned structured-assertion stream** (`gold/congress_data/congress/congress_structured_assertions/<partition>/data.jsonl`) are **not** consumed by any UI route. Congress's detail page lands on `DomainDocumentDetail.tsx` which renders the *silver* row as a JSON tree and stops — there is no congress-side equivalent of the player's mentions/assertions panels.
- **`LABEL_PACK_BY_LOCATION`** (the export-name normalization in `8a78676`) — **no UI reference**, so the underscore-drop is silent for now. The TS side has never hit this symbol.

---

## D. Domain coverage gap

The originally-intended `viewer-ui` per-domain SPAs were **collapsed into the unified `catalyst-data-ui`** at some point before this session — no per-domain SPA directory survives. What exists today:

- **media-ingest**: full first-class experience. Player route, transcript, diarization, mentions panel, assertions panel, HITL approve/reject, S3 deep-links. The `/viewer/api/media/documents/{id}/{transcription,diarization,chunks,mentions,assertions}` family is fully wired.
- **congress-wtf**: shell only. `CongressList` renders the silver-row list, click goes to `DomainDocumentDetail` which is a JSON-tree fallback. **No congress mentions panel, no assertions panel, no AMR view, no temporal-validity view.** All the new richness that landed in `6e17418` + `76ed462` is unreachable from the UI.
- **open-leaks**: same as congress — list + JSON-tree fallback.

So the "destination architecture" (per CD-6oo5 "Per-domain SPA scaffolding") looks like a **plugin-by-route pattern**: the registry-driven sub-tab list in `Documents.tsx` already supports adding new domains via a `LISTS: Record<string, React.ComponentType>` map. The natural extension is a **`DETAILS: Record<string, React.ComponentType>`** map so each domain can swap in its own detail page (player for media; bill-detail-with-assertions for congress; leak-source-detail for leaks) rather than every non-media domain falling back to `DomainDocumentDetail`.

---

## E. AMR-specific UI gaps

What the new wire shape needs that nothing in the UI today provides:

1. **Polarity / modality glyph row on `AssertionCard`.** The card has badges for `NEG` and `H` (hedged) only — there is no surface for `polarity=false` (AMR `:polarity -`) or `modality="possible"|"obligation"` (AMR `:mode`). These are first-class AMR-graph attributes on every projection.
2. **AMR-frame chip + role-mapping tooltip.** "This assertion came from `introduce-01`" vs. "novel predicate (`is_novel_predicate=true`) — not in the pack" is the load-bearing distinction for AMR-as-spine. A chip rendering `amr_frame` (with a "novel" outline variant) plus a hover-tooltip showing `amr_role_mapping` (`ARG0 → subject`, `ARG1 → object`, `ARG2 → instrument`, …) is the minimum table-stakes view.
3. **Provenance source-chip.** `provenance.extraction_method ∈ {amr_projection, structured, ner_ensemble, …}` is the only way to tell apart "this came from AMR walking" vs "this came from cosponsor CSV rows." A small uppercase chip on the assertion card (`AMR` / `STRUCT` / `LLM`) is the right surface.
4. **Temporal-validity range.** The `Clock` icon today shows media-timeline `temporal_start_ms`. A second time surface — `t_valid_from … t_valid_until` (or "atemporal" for `is_atemporal=true`) — is needed on every congress/leaks card. The structured-assertion stream is already stamping these from API date fields per `6e17418`.
5. **Point-in-time query toggle.** Once temporal validity is on the wire, the obvious filter is "show only assertions valid as of <date>." Today there is no date-filter UI at all.
6. **Statement-node graph view.** The platinum-layer Neo4j subgraph for a given bill (Statement nodes with AMR fields, edges to CanonicalEntity nodes) has no SPA surface. Given `@xyflow/react` is already a dep, a `/documents/congress/:id/graph` view is plausible scope.
7. **Entity link badges.** `subject_entity_id` and `object_entity_id` linking to the canonical entity (once concordance runs) should resolve to a clickable chip — today the UI only shows the surface form `subject_text`.

---

## F. The refactor plan

Ordered by ROI. Each step is independent enough to ship without the next.

### 1. Regenerate `src/types/media.ts` against `catalyst_contracts_core` *(M, ~1 day)*
- Split `Mention`/`Assertion`/`Provenance` out of `media.ts` into a new `src/types/contracts.ts`, mirroring the Python `catalyst_contracts_core.types` shape exactly. Keep `MediaDocument`, `Transcription`, `Diarization`, `Segment`, `ChunkInfo`, `TimelineMarker` in `media.ts` — those are media-domain extras, not part of the unified contract.
- Rename `mention_type → canonical_type` at the source of truth. Add a thin compat shim (`get mention_type() { return this.canonical_type; }` via a getter, or a `getMentionType(m): string` helper) so the 18-ish read sites can be migrated incrementally without a single megacommit.
- Add the missing Assertion fields with sensible defaults: `amr_frame: string | null`, `polarity: boolean`, `modality: string | null`, `t_valid_from: string | null`, `t_valid_until: string | null`, `is_atemporal: boolean`, `is_novel_predicate: boolean`, `amr_role_mapping: Record<string, string>`, `subject_entity_id/object_entity_id/subject_mention_id/object_mention_id: string | null`.
- Drop `predicate_canonical` from the type and the one sort site (`AssertionPanel.tsx:78`).
- **What breaks if we skip it:** every congress/leaks assertion read goes through `mention_type → undefined`. Type errors at compile-time-ish, runtime garbage at display.
- **What unblocks:** every downstream step. This is the load-bearing PR.

### 2. Wire mentions + assertions endpoints into the generic per-domain factory *(M, ~1-2 days)*
- Backend side: add `/documents/{id}/mentions` and `/documents/{id}/assertions` to `documents_factory.make_documents_router` so every registered domain gets them automatically. Source from `gold/<location>/<group>/<doc>_mentions/<partition>/data.jsonl` + `gold/<location>/<group>/<doc>_assertions/<partition>/data.jsonl`, with the structured-assertion stream layered in (`gold/congress_data/congress/congress_structured_assertions/<partition>/data.jsonl`).
- Frontend side: add `fetchDomainMentions(slug, id)` + `fetchDomainAssertions(slug, id)` in `api/client.ts`, parallel to `fetchDomainDocument`.
- **What breaks if we skip it:** congress + leaks remain read-only JSON-tree views. The AMR-rich data has nowhere to land.
- **What unblocks:** step 3 (the congress detail page).

### 3. Promote `DomainDocumentDetail` to a domain-pluggable shell + ship `CongressBillDetail` *(L, ~2-3 days)*
- Add `DETAILS: Record<string, React.ComponentType>` to `Documents.tsx` mirroring `LISTS`. Route `/documents/:domain/:id` looks up DETAILS first; falls back to the existing JSON-tree page.
- Ship a `CongressBillDetail.tsx` that uses the new mentions/assertions endpoints from step 2. Lay it out as: header (title + bill metadata badges) → tab strip (Mentions | Assertions | Raw JSON) → existing JSON-tree fallback under "Raw JSON".
- Reuse `EntityPanel.tsx` + `AssertionPanel.tsx` from the media player. They are *almost* domain-agnostic — the only media-specific bits are `temporal_start_ms` (which is null for text-only domains and already null-guarded) and the `onSeek` callback (just omit it).
- **What breaks if we skip it:** congress + leaks remain dead-ends in the UI. The whole AMR-as-spine pipeline produces output that no one ever sees.
- **What unblocks:** AMR-specific UI work (step 4).

### 4. Extend `AssertionCard` with AMR fields *(S, ~half day)*
- Add `polarity` glyph (`¬` next to subject when `polarity === false`), `modality` chip (`?` for `possible`, `!` for `obligation`), `amr_frame` chip (`introduce-01` styled like a code token; `outline + amber` variant when `is_novel_predicate`), and an `extraction_method` source chip (`AMR` / `STRUCT` / `LLM`).
- Existing `NEG` / `H` badges keep working — `negated` is the legacy mirror of `!polarity` per the contract's `_sync_negated_with_polarity` validator.
- **What breaks if we skip it:** we ship congress detail without surfacing the *reason* AMR-as-spine exists. Functionally fine; informationally hollow.
- **What unblocks:** the temporal-validity work (step 5) makes more sense once the basic AMR fields are visible.

### 5. Add temporal-validity rendering + point-in-time toggle *(S, ~half day)*
- On every assertion card in non-media domains: render `t_valid_from … t_valid_until` with the existing `Clock` icon style. Render `∞` when `t_valid_until === null`. Render `(atemporal)` muted chip when `is_atemporal === true`.
- Add a single date-picker control on `AssertionPanel.tsx` that, when set, filters assertions to those whose validity window covers the chosen date.
- **What breaks if we skip it:** the structured-assertion stream's date stamping is hidden. Cosponsors that ended in 2019 look the same as ones still active.
- **What unblocks:** future "show me everyone cosponsoring TAKE IT DOWN as of 2024-03-15" workflows.

### 6. (Optional, defer) Neo4j Statement-node graph view *(L, ≥3 days)*
- New route `/documents/:domain/:id/graph`. Backend endpoint `GET /viewer/api/<domain>/documents/<id>/graph` runs a bounded Cypher (`MATCH (s:Statement)-[r]->(e:CanonicalEntity) WHERE s.source_document_id = $id RETURN ...`).
- Render with `@xyflow/react` + `@dagrejs/dagre` (both already in `package.json`).
- **Why optional:** the JSON list views in steps 3–5 cover 80% of the "is the pipeline actually working" question. A graph view is the *interesting* surface but not the load-bearing one.

---

## TL;DR

The catalyst-data-ui SPA is a single unified Vite/React 19 app, not a per-domain split, and it speaks to a FastAPI viewer mounted at `/viewer/api/*`. The wire-shape gap is concentrated in **one file** (`src/types/media.ts`) — its `Mention` and `Assertion` types are flat-SPO legacy and miss every AMR-rich field on the new `catalyst_contracts_core` contract (`amr_frame`, `polarity`, `modality`, `t_valid_from/until`, `subject_entity_id`, `extraction_method` discrimination, etc.). The platinum-layer Neo4j graph and the new bill-partitioned `congress_structured_assertions` stream are entirely unreachable from the UI today. **The 80% fix is two PRs:** regenerate the types module against contracts-core (~1 day) and ship a `CongressBillDetail` page wired into a domain-pluggable detail shell (~2-3 days), reusing the existing media-side `EntityPanel`/`AssertionPanel` components which are already nearly domain-agnostic. Everything else (AMR glyphs, temporal-validity, graph view) layers on top of that foundation without rewriting it.
