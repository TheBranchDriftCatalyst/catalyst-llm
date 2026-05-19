# DRY Audit: catalyst-data + catalyst-llm Execution Paths

**Date:** May 2026  
**Scope:** Four overlapping execution paths across Dagster assets, seeding, benchmarking, and testing  
**Repos:** `/Users/panda/catalyst-devspace/workspace/{catalyst-data, catalyst-llm}`

---

## A. Entry Points Matrix

| Path | Entry Command | Module/Script | Canonical Invocation |
|------|---------------|---------------|----------------------|
| **Dagster (Production)** | `task dev` | `dagster dev -m {media_ingest,congress_data,open_leaks}` | All 3 code locations; MinIO @ localhost:9000 (dev) or cluster (prod) |
| | `task dagster:materialize:congress` | curl → GraphQL | Launch bills_discovery_job + members_discovery_job |
| **Seeding (Dev)** | `task seed:congress` | `scripts/dev/seed_local.py --domain congress` | 5 hand-picked bills from `bill_manifest.yaml::seed_subset` |
| | `task seed:media` | `scripts/dev/seed_local.py --domain media` | 5 videos from `audio_manifest.yaml` (cached diarization) |
| | `task seed:leaks` | `scripts/dev/seed_local.py --domain leaks` | 5 cables from `cablegate_sample.csv` (fixed) |
| **Benchmarking** | `task bench:chunks:regen:congress` | `packages/congress-data/tests/integration/test_pipeline.py::test_materialize_bill_chunks_sweep` | Every bill in `bill_manifest.yaml` via `TestManifestSweep` |
| | `task bench:chunks:regen:media` | `packages/media-ingest/tests/integration/test_chunks_cpu.py::media_chunks_materialized` | Every video in `audio_manifest.yaml` (filtered by diarization cache) |
| | `task bench:chunks:regen:leaks` | `packages/open-leaks/tests/integration/test_chunks.py` | Single unpartitioned `leak_chunks` asset |
| | `task bench:run` | `tests/benchmark_harness.py` | Phase A (NER ensemble) → Phase 4 (SPO) → F1 report |
| | `task bench:ground-truth` | `tests/shared/ground_truth.py::generate_ensemble_ground_truth` | Consensus from best models |
| **Testing** | `task test` | `pytest packages/*/tests/ --ignore=integration` | Unit tests only |
| | `task integration` | `pytest packages/*/tests/integration/ -k "bronze or silver"` | Full pipeline (no LLM) |
| | `task integration:congress:full` | `pytest packages/congress-data/tests/integration/ -v` | With LLM (requires LLM_API_KEY) |
| | `task test:e2e:gaps` | `scripts/dev/seed_e2e_fixtures.py → playwright` | Viewer UI Gap specs |

---

## B. Shared Building Blocks vs. Actual Reuse

### 1. **Chunk → State Dict Construction**

**Should Share:** Unified `_chunk_field()` lookup pattern (robust to dict vs. Pydantic shape).

**Actual Status:**
- ✅ **ALREADY UNIFIED:** `/catalyst-llm/packages/catalyst-exgraph/src/catalyst_exgraph/resource.py:40-50`  
  ```python
  def _chunk_field(chunk: Any, name: str, default: Any = "") -> Any:
      """Read a TextChunk field — robust to dict shape from JSON IO managers."""
      if isinstance(chunk, dict):
          return chunk.get(name, default)
      return getattr(chunk, name, default)
  ```
  Handles both dict (MinioIOManager output) and Pydantic (TextChunk model).

- ❌ **NOT IMPORTED BACK:** This function lives in ExtractionResource but is not exposed for benchmark harness / other paths to reuse.  
  **Evidence:** `/catalyst-data/libs/dagster-io/src/dagster_io/append_io_manager.py:58-62` duplicates the same pattern inline:
  ```python
  for item in obj:
      if hasattr(item, "model_dump"):
          lines.append(json.dumps(item.model_dump(), default=str))
      elif isinstance(item, dict):
          lines.append(json.dumps(item, default=str))
  ```

- ⚠️ **DUPLICATION RISK:** If benchmark_harness.py (which iterates chunks) needs to read a chunk field, it must either:
  1. Replicate `_chunk_field()` logic (not done yet, but fragile),
  2. Import from catalyst-exgraph (coupling), or  
  3. Guarantee chunks are always Pydantic (breaks if switching IO managers).

### 2. **Extraction Resource Instantiation**

**Should Share:** Single factory for `ExtractionResource(...)` with consistent model + prompt + label-pack resolution.

**Actual Status:**
- ✅ **CENTRALIZED ENTRY POINT:** `extract_validated()` in `dagster_io/extraction.py:58-110`  
  All asset-level extraction flows through this (Dagster-integrated).

- ⚠️ **MULTIPLE INSTANTIATION PATHS FOR NON-ASSETS:**
  1. **Benchmark harness** (`tests/benchmark_harness.py` ~line 300+): Constructs `ExtractionResource()` directly per model.
  2. **Test step4** (`tests/test_step4_wiring_qa.py`): Also direct instantiation.
  3. **Benchmark config** (`tests/benchmark_config.py`): Model registry (ALL_MODELS) defines model specs.

  Each path independently resolves:
  - `LLM_MODEL` env var (or defaults to "gliner")
  - `PROMPT_REGISTRY_DIR` resolution
  - Label pack ID from `code_location` string

  **Risk:** If label-pack logic changes (e.g., new location → new ID), must update `_LABEL_PACK_BY_LOCATION` in dagster_io + bench harness directly.

### 3. **MinIO / S3 Endpoint Resolution**

**Should Share:** Single place to read `DAGSTER_S3_ENDPOINT_URL` and fall back to localhost.

**Actual Status:**
- ❌ **DUPLICATED ACROSS PATHS:**
  1. **seed_local.py:51-62** — forcibly sets `DAGSTER_S3_ENDPOINT_URL` BEFORE any imports:
     ```python
     os.environ["DAGSTER_S3_ENDPOINT_URL"] = _endpoint_override or "http://localhost:9000"
     ```
  2. **seed_local.py:82-98** — reads it again in `_maybe_regen()`:
     ```python
     endpoint_url=os.environ.get("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")
     ```
  3. **benchmark_harness.py** — implicitly via `select_io_managers()` (which reads DAGSTER_S3_* env).
  4. **tests/shared/medallion.py:53-58** — manual resolution:
     ```python
     endpoint_url=os.environ.get("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")
     ```
  5. **libs/dagster-io/src/dagster_io/bench/store.py** — another manual read.

  **Pattern:** Every script that touches MinIO has its own fallback logic (verbose, error-prone).

- **Conftest Path:** `tests/conftest.py:46-50` sets safe test defaults globally.
  ```python
  monkeypatch.setenv("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")
  ```

### 4. **Test Fixtures & "5-Sample" Curation**

**Should Share:** Single source of truth for deterministic subset selection.

**Actual Status:**
- ✅ **Partially Centralized:**
  - Congress: `bill_manifest.yaml::seed_subset` — hand-curated 5 bills (one place).
  - Media: `audio_manifest.yaml::videos[]` — full list, sampled to first N in seed_local.py.
  - Leaks: `cablegate_sample.csv` — static 5 cables (bundled fixture).

- ❌ **INCONSISTENT SELECTION LOGIC:**
  1. **seed_local.py (congress)** reads `seed_subset` key, falls back to first N:
     ```python
     seed_subset = raw.get("seed_subset") or []
     if seed_subset:
         selected = seed_subset[:limit]
     else:
         selected = bills[:limit]
     ```

  2. **bench:chunks:regen:congress** (`test_pipeline.py`) reads ALL bills from manifest:
     ```python
     @pytest.mark.skipif(not _MANIFEST_BILL_IDS, reason="bill_manifest.yaml empty")
     def test_materialize_bill_chunks_sweep():
         # Materializes every entry in manifest, not seed_subset
     ```

  3. **bench:gt-candidates** (`sample_gt_candidates.py`) draws from **already-materialized chunks**:
     ```python
     # Assumes chunks have been pre-generated by bench:chunks:regen
     # Diversity-samples from .test-output/gt-candidates.json (if present)
     ```

  **Risk:** seed:congress → 5 bills. bench:chunks:regen:congress → 30 bills. gt-candidates → samples from materialized. If bill_manifest changes, seed and bench diverge.

### 5. **PROMPT_REGISTRY_DIR Resolution**

**Should Share:** Single env-var lookup with sensible fallback.

**Actual Status:**
- ⚠️ **DUPLICATED READS:**
  1. **extraction.py:98** — reads in `extract_validated()`:
     ```python
     prompt_dir = os.environ.get("PROMPT_REGISTRY_DIR", "")
     ```
  2. **benchmark_harness.py:300+** — sets it explicitly:
     ```python
     env = {"PROMPT_REGISTRY_DIR": str(ROOT / "k8s" / "shared" / "prompts")}
     ```
  3. **test_extraction_e2e.py** — also sets it.

  Each path independently resolves the path. **But:** production (k8s) mounts prompts at a different path than dev (local filesystem).

- **No Unified Registry Factory:** No single `resolve_prompt_dir()` function; each callsite does its own logic.

---

## C. Confusing Overlaps & Potential Conflicts

### 1. **task seed:congress vs. task bench:chunks:regen:congress**

| Aspect | seed:congress | bench:chunks:regen:congress |
|--------|---------------|---------------------------|
| **Manifest Source** | `bill_manifest.yaml` | `bill_manifest.yaml` |
| **Bills Selected** | `seed_subset` (5 hand-picked) | ALL entries (30+ in full manifest) |
| **Partitions Materialized** | First 5 (or `--limit N`) | Every entry (full sweep) |
| **Assets Materialized** | `[bill_documents, bill_chunks]` | `bill_chunks` only |
| **IO Manager** | MinioIOManager (DAGSTER_S3_*) | LocalJsonIOManager (→ .test-output/) |
| **Use Case** | Fast dev bootstrap | Full benchmark coverage |
| **Env Mutability** | Overrides DAGSTER_S3_ENDPOINT_URL | Respects DAGSTER_IO_BACKEND |

**Conflict:** If a developer runs `task seed:congress` then `task bench:chunks:regen:congress`, the first creates data in S3 (MinIO), the second in `.test-output/`. If an asset later tries to read from S3 (expecting seed output) but finds nothing (because bench materialized locally), it fails silently.

**Risk Level:** MEDIUM — Paths diverge early, but documentation is clear. However, no shared state between them.

### 2. **extract_validated() (canonical path) vs. ExtractionResource direct instantiation**

| Caller | Method | Consistency |
|--------|--------|-------------|
| **Dagster assets** (asset_factory.py) | `extract_validated(chunks, code_location)` | ✅ Always goes through wrapper |
| **test_extraction_e2e.py** | `extract_validated(...)` | ✅ Uses wrapper |
| **test_step4_wiring_qa.py** | `ExtractionResource(...).extract_assertions(...)` | ⚠️ Direct, but documents as test-only |
| **benchmark_harness.py Phase A** | `extract_validated(...)` | ✅ Uses wrapper |
| **benchmark_harness.py Phase 4** | `ExtractionResource(...)` direct | ⚠️ Direct for SPO-specific tuning |

**Overlap:** The docstring in extraction.py claims "single extraction path" but benchmark harness breaks it for Phase 4 (SPO tuning). Not a bug, but confusing for new readers.

### 3. **MinioIOManager vs. LocalJsonIOManager assignment**

| Path | Backend | When Used | Evidence |
|------|---------|-----------|----------|
| `task dev` | MinIOIOManager | Dagster UI (full pipeline) | Taskfile.yml:121 sets DAGSTER_S3_ENDPOINT_URL |
| `task seed:*` | MinioIOManager | Manual materialize() call | seed_local.py:60 forces localhost MinIO |
| `task bench:chunks:regen:*` | LocalJsonIOManager | Integration tests | test_chunks_cpu.py:71 explicit |
| `task test` (unit) | LocalJsonIOManager | conftest.py | conftest.py:50 safe defaults |
| `task integration` | LocalJsonIOManager | Integration tests | Per-domain conftest fixtures |

**Overlap:** All paths respect `DAGSTER_IO_BACKEND` env var (set at runtime), but:
- seed_local.py ignores it (always uses Minio).
- bench:chunks:regen defaults to local.
- Integration conftest fixtures override to local.

**Risk:** If someone sets `DAGSTER_IO_BACKEND=local` before `task seed:congress`, the seed will still try to write to MinIO (because seed_local.py hardcodes S3Client construction), and MinIO startup might be skipped. Conversely, setting it to `minio` before tests breaks integration tests (they expect local).

### 4. **"--with-gold" placeholder vs. no gold-layer consolidation**

From `seed_local.py` (checked git history):
```python
parser.add_argument("--with-gold", action="store_true", default=False, help="...")
# ... then in code:
if args.with_gold:
    print("  --with-gold: media gold-layer pass not yet implemented (TODO)")
```

**Current State:** The `--with-gold` flag is declared but never implemented. Benchmark harness has no gold-layer pass either (it just reads pre-computed chunks). **Risk:** When gold-layer extraction is added, where will it live?
- In seed_local.py (replicating bench code)?
- In benchmark_harness.py (replicating seed code)?
- As a shared function (not yet created)?

---

## D. Concrete DRY Violations

### Violation 1: S3 Endpoint Fallback (3 places)

**Files:**
- `scripts/dev/seed_local.py:51-62`
- `tests/shared/medallion.py:53-58`
- `libs/dagster-io/src/dagster_io/bench/store.py` (similar pattern)

**Pattern:**
```python
# seed_local.py:60
os.environ["DAGSTER_S3_ENDPOINT_URL"] = _endpoint_override or "http://localhost:9000"

# medallion.py:57
endpoint_url=os.environ.get("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")

# bench/store.py (implied via S3Client construction)
endpoint_url=os.environ.get("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")
```

**Recommendation:** Create `dagster_io.s3_client.resolve_s3_endpoint()` function that all paths call.

### Violation 2: Chunk Field Extraction (2+ places)

**Files:**
- `/catalyst-llm/packages/catalyst-exgraph/src/catalyst_exgraph/resource.py:40-50` (_chunk_field)
- `libs/dagster-io/src/dagster_io/append_io_manager.py:58-62` (inline hasattr/isinstance)
- Potential duplication in benchmark_harness.py (not yet, but risk)

**Pattern:**
```python
# resource.py
def _chunk_field(chunk: Any, name: str, default: Any = "") -> Any:
    if isinstance(chunk, dict):
        return chunk.get(name, default)
    return getattr(chunk, name, default)

# append_io_manager.py (reimplemented)
if hasattr(item, "model_dump"):
    lines.append(json.dumps(item.model_dump(), default=str))
elif isinstance(item, dict):
    lines.append(json.dumps(item, default=str))
```

**Recommendation:** Export `_chunk_field()` from catalyst_exgraph and reuse in append_io_manager.

### Violation 3: PROMPT_REGISTRY_DIR Resolution (2 places)

**Files:**
- `libs/dagster-io/src/dagster_io/extraction.py:98`
- `tests/benchmark_harness.py:~line 300`

**Pattern:**
```python
# extraction.py:98
prompt_dir = os.environ.get("PROMPT_REGISTRY_DIR", "")

# benchmark_harness.py:~300
env = {"PROMPT_REGISTRY_DIR": str(ROOT / "k8s" / "shared" / "prompts")}
```

**Recommendation:** Create `dagster_io.prompts.resolve_prompt_dir(fallback=None)` that handles k8s vs. local paths.

### Violation 4: Label Pack Lookup (defined once but checked multiple times)

**Files:**
- `libs/dagster-io/src/dagster_io/extraction.py:39-44` (_LABEL_PACK_BY_LOCATION)
- `tests/benchmark_harness.py` (assumes same mapping, not explicit)
- `tests/test_step4_wiring_qa.py` (assumes same, not explicit)

**Pattern:**
```python
# extraction.py
_LABEL_PACK_BY_LOCATION: dict[str, str] = {
    "congress": "congress",
    "congress_data": "congress",
    "media": "media",
    "media_ingest": "media",
}

# benchmark_harness.py: no explicit reference, assumes extraction.py handles it
# test_step4_wiring_qa.py: similar assumption
```

**Risk:** If a new code location is added (e.g., "knowledge_graph"), the lookup table must be updated in ONE place. Currently works, but no shared export of the constant.

### Violation 5: TestManifestSweep Bill Selection Logic (2 partial duplications)

**Files:**
- `packages/congress-data/tests/integration/test_pipeline.py` (reads bill_manifest, selects ALL)
- `scripts/dev/seed_local.py` (reads bill_manifest, selects seed_subset OR first N)

**Pattern:**
```python
# test_pipeline.py
p = Path(__file__).resolve().parents[1] / "fixtures" / "bill_manifest.yaml"
raw = yaml.safe_load(p.read_text()) or {}
_MANIFEST_BILL_IDS = [b["bill_id"] for b in raw.get("bills", [])]

# seed_local.py (similar, but filters)
manifest = _congress_fixtures() / "bill_manifest.yaml"
raw = yaml.safe_load(manifest.read_text()) or {}
seed_subset = raw.get("seed_subset") or []
bills = raw.get("bills", [])
if seed_subset:
    selected = seed_subset[:limit]
else:
    selected = bills[:limit]
```

**Recommendation:** Create `dagster_io.manifests.load_bill_manifest(domain="congress", subset=None)` that handles both full and seeded reads.

---

## E. Recommendations (ROI-Ordered)

### 1. **Consolidate S3 Endpoint Resolution** (HIGH ROI)

**What to Merge:**  
All `os.environ.get("DAGSTER_S3_ENDPOINT_URL", "http://localhost:9000")` reads → single `dagster_io.s3_client.resolve_s3_endpoint(override_env_var=None)` function.

**Who Would Notice:**  
- seed_local.py, medallion.py, bench/store.py (internal refactor, no API change).
- External: None (all internal to catalyst-data).

**Effort:** ~2 hours (create function, 3 call sites, add unit test).

**Impact:** Eliminates 3 duplicate fallback logic blocks; single point of truth if localhost:9000 is replaced.

---

### 2. **Export _chunk_field() from catalyst-exgraph** (MEDIUM ROI)

**What to Merge:**  
Move `_chunk_field()` to a public utility module in catalyst-exgraph; re-export from append_io_manager and any bench code that needs it.

**Who Would Notice:**  
- append_io_manager.py (internal refactor).
- benchmark_harness.py (future-proofing, no change needed now).
- ExtractionResource docstring (update to reference shared utility).

**Effort:** ~1.5 hours (move function, update imports, add __all__ export).

**Impact:** Prevents duplication when benchmark harness learns to read chunk fields (currently safe, but fragile).

---

### 3. **Create Unified Manifest Loaders** (MEDIUM ROI)

**What to Merge:**  
`dagster_io.manifests` module with `load_congress_manifest(subset=False, limit=None)` and `load_media_manifest(limit=None)` functions that handle:
- Correct fixture path lookup.
- seed_subset vs. full bill list.
- Doc filtering by cache presence (media).

**Who Would Notice:**  
- seed_local.py (simplifies 3 domain branches).
- test_pipeline.py (replaces inline YAML loading).
- benchmark_harness.py (could use for fixture discovery).

**Effort:** ~3 hours (3 loaders, docstring, integration test).

**Impact:** Single source of truth for "which bills/videos are in the test set"; seed/bench/test alignment guaranteed.

---

### 4. **Centralize PROMPT_REGISTRY_DIR Resolver** (LOW-MEDIUM ROI)

**What to Merge:**  
`dagster_io.prompts.resolve_prompt_dir(deployment="dev|prod", fallback=None)` that returns correct path based on context.

**Who Would Notice:**  
- extraction.py (one line change).
- benchmark_harness.py (one line change).
- test_extraction_e2e.py (one line change).

**Effort:** ~1.5 hours (create function, 3 call sites).

**Impact:** Future-proofs prompt loading if path changes; avoids hardcoding "k8s/shared/prompts" in multiple places.

---

### 5. **Export _LABEL_PACK_BY_LOCATION and Validate at Startup** (LOW ROI)

**What to Merge:**  
Re-export `_LABEL_PACK_BY_LOCATION` from extraction.py as a public constant; add runtime check in benchmark_harness startup that validates all models' code_location keys are in the map.

**Who Would Notice:**  
- benchmark_harness.py (one-time startup validation).
- test_step4_wiring_qa.py (can import constant for documentation).

**Effort:** ~45 minutes (export, add validation, update docstrings).

**Impact:** Catches misconfiguration early; documents the mapping explicitly.

---

## Summary

The four execution paths (Dagster, Seed, Bench, Test) were **correctly separated** by design but share **too much duplicated config logic** in the glue code:

- **S3 endpoint fallback:** 3 places (easily consolidated).
- **Chunk field extraction:** 2 places (expose from ExtractionResource).
- **Manifest loading:** 2 near-duplicate implementations (consolidate with loader factory).
- **Prompt directory:** 2 manual resolves (create resolver function).
- **Label pack:** Already centralized but not exported (export + validate).

No breaking bugs detected, but **medium-term risk:** if config logic changes (e.g., new S3 deployment URL), all paths must be updated independently. Consolidating via factories eliminates that risk and improves testability.

