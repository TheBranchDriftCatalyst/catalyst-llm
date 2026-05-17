# catalyst-exgraph examples

Runnable demos of the extraction pipeline. Each example is
self-contained and uses stubs / hand-crafted inputs where running
the full models would require GPUs or external services.

## `amr_congress_mvp.py` — AMR-spine extraction end-to-end

Demonstrates the **greenfield AMR-as-spine** pipeline on a congressional
sentence. Mirrors the production data path:

```
chunk text
  → NER ensemble (RegexNerClient against the congress label pack)
  → consensus mentions
  → AMR parser  (stubbed PENMAN — amrlib not required for the demo)
  → AmrToAssertionNode (real, walks the PENMAN graph)
  → list[AmrAssertion]
```

The hand-built PENMAN represents the sentence:

> *"Rep. Smith introduced H.R. 1234, which was referred to the
> Committee on Energy and Commerce, but the bill was never reported."*

It exercises:

- **Two predicate frames** — `introduce-01 → sponsors`, `refer-01 → refers_to`
- **Reentrancy** on the bill node `b` (object of `introduce-01` AND
  argument of the `refer` relation)
- **Polarity** on a nested `report-01` (`:polarity -`) — the negation
  flows through to `AmrAssertion.polarity = False` on the third
  emitted assertion (the "but the bill was never reported" clause)
- **Real consensus mentions** from the regex voter resolving `H.R. 1234`
  to a canonical entity reference; the AMR variable `b` gets that
  mention_id in `canonical_entity_refs`

### Run

```bash
cd packages/catalyst-exgraph
uv run python examples/amr_congress_mvp.py
```

### Expected output

```
─── Output: AmrAssertions ───────────────────────────────────────────
  [1] 'Rep. Smith'                       --introduces+-->  'H.R. 1234'
       entity-ref 'b' = m-000
  [2] 'H.R. 1234'                        --refers_to+-->   'Committee on Energy and Commerce'
       entity-ref 'b' = m-000
  [3] 'Committee on Energy and Commerce' --reported_by─--> 'H.R. 1234'   ← NEGATED
       entity-ref 'b' = m-000
```

### Why stub the AMR parser?

`amrlib` pulls in ~500 MB of model weights and requires `torch`. The
projection node (the part this demo is meant to showcase) doesn't care
how the PENMAN string was produced — that's the point of the
sentence-isolation contract. Stubbing the parser lets the demo run on
any laptop in a fraction of a second.

To run the **real** parser end-to-end:

```bash
cd packages/catalyst-langgraph
uv pip install -e ".[amr]"      # adds amrlib
# then in the demo, replace _StubParse with the actual client call:
#   client = AmrParserClient(sentence_splitter="spacy")
#   parses = await client.parse(_CHUNK)
```

## See also

- `docs/reseearch/extraction-pipeline-gaps.md` — design context: ONTOLOGY
  base-case gaps + AMR-as-spine architecture decisions.
- `catalyst-data/k8s/congress-data/prompts/congress.labels.yaml` — the
  domain label pack the demo loads.
- `catalyst-langgraph` README — the encoder clients + AmrParserClient
  + LabelPack loader.
