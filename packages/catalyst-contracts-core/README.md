# catalyst-contracts-core

Shared enums and base types for the extraction + knowledge-graph
domain. Tiny package (~97 LOC) — intentionally narrow scope.

## What's here

- `MentionType` — entity types the extractor produces (PERSON, ORG,
  GPE, LOC, DATE, LAW, EVENT, MONEY, NORP, FACILITY, OTHER).
- `AlignmentType` — concordance alignment shapes (sameAs,
  possibleSameAs, relatedTo, partOf).
- `ExtractionMethod` — provenance label for how a fact was produced
  (llm, spacy, regex, manual, structured).
- `Provenance` — Pydantic base carrying source_document_id, chunk_id,
  confidence, extraction_method, timestamp, span offsets.

## Why it's a separate package

This package lives at the seam between two repos that BOTH consume
these types:

1. **`catalyst-llm` (this monorepo)** — `catalyst-exgraph` produces
   extractions tagged with `MentionType` / `Provenance`.
2. **`catalyst-data/libs/dagster-io`** — the dagster IO layer
   imports `from catalyst_contracts_core.enums import (...)` to type
   its persistence models.

Folding contracts-core into either side would break the other. The
package's scope is intentionally narrow (no validators, no models,
no graph logic — just leaf types) so it never grows into something
heavier.

## Domain note

These enum values are extraction- and knowledge-graph-specific — NOT
universal catalyst primitives. The module name reflects the scope of
the catalyst-data contracts pipeline.
