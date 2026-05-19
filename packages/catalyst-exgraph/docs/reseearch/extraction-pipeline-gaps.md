# Extraction Pipeline Gaps vs. ONTOLOGY Base Case

This doc captures the two largest semantic gaps the ONTOLOGY (`catalyst-data/ONTOLOGY.md`) calls out and our current extraction pipeline does not fully address: **AMR parsing for hard sentences** (§3.3) and **temporal validity intervals** beyond the chunk's `temporal_start/end_ms`. Both are grounded in concrete congressional-text examples so the beads work that follows has a clear target.

> **Status (current):**
>
> - **AMR-as-spine implementation: SHIPPED** — `catalyst_langgraph.clients.amr_parser.AmrParserClient` + `catalyst_exgraph.nodes.amr_project.AmrToAssertionNode` + per-domain `amr_frames` mapping in the LabelPack (`congress.labels.yaml`, `media.labels.yaml`). 82 tests across dev + QA suites green. Runnable MVP at `packages/catalyst-exgraph/examples/amr_congress_mvp.py`.
> - **AMR complexity gate**: NOT IMPLEMENTED. Current path runs AMR on every sentence. A future complexity gate (run AMR only when SPO LLM produces low-confidence triples on sentences with negation/modality markers) is still open work. See bead llm-71u follow-ups.
> - **Temporal validity intervals: SHIPPED (bead llm-mln)** — `contracts_core.Assertion` carries `t_valid_from` / `t_valid_until` / `is_atemporal` as first-class fields. Two stamping paths exist:
>   - **AMR projection** (`AmrToAssertionNode`): atemporal predicates (`cites`, `references`, `amends`, `repeals`, `supersedes`, `codified_at`) get `is_atemporal=True`. Predicate-specific date stamping from `:time` qualifiers is a follow-up.
>   - **Structured projection** (`catalyst-data/packages/congress-data/src/congress_data/assets/structured_assertions.py`): `Cosponsor.sponsorship_date/withdrawn_date`, `Term.start_year/end_year`, and `PublicLaw.signed_date` are deterministically stamped onto STRUCTURED-method assertions. 18 unit + property + scenario tests covering point-in-time validity queries.

---

## AMR — Abstract Meaning Representation (§3.3)

AMR encodes a sentence as a **rooted directed graph** where nodes are concepts/predicates (using PropBank frames like `sponsor-01`) and edges are normalized semantic roles (`:ARG0` = doer, `:ARG1` = thing-done-to, `:time`, `:location`, `:condition`, …). The whole sentence collapses into one graph instead of fragmenting into SPO tuples.

### Example: a sentence our current SPO mangles

> *"Rep. Smith introduced H.R. 1234, which was referred to the Committee on Energy and Commerce, but the bill was never reported."*

**What our SPO pipeline produces today** (the LLM extracts triples sentence-by-sentence):

```
(Rep. Smith,      sponsored,    H.R. 1234)
(H.R. 1234,       referred_to,  Committee on Energy and Commerce)
(H.R. 1234,       reported_by,  Committee on Energy and Commerce)   ← negation lost
```

The third triple is *wrong*. The word "never" attaches to "reported" but our SPO prompt has nowhere natural to put it. We have a `negated` boolean per triple, but a generative LLM forgets to set it on stacked clauses.

**What AMR produces:**

```
(i / introduce-01
   :ARG0 (s / person :name "Rep. Smith")
   :ARG1 (b / bill :id "H.R. 1234"
            :ARG1-of (r / refer-01
                        :ARG2 (c / committee
                                  :name "Energy and Commerce"))
            :ARG1-of (n / report-01
                        :polarity -          ← NEGATION as a first-class attribute
                        :ARG0 c)))           ← REENTRANCY: same committee, one node
```

Three things AMR gets right that our SPO pipeline drops:

1. **`:polarity -`** — negation is a graph attribute, not a model guess at a boolean.
2. **Reentrancy** — "Committee on Energy and Commerce" is one node referenced twice (once as the referee, once as the implicit reporter). Our SPO emits the string twice and clustering has to merge it.
3. **Single normalized form** — "Smith sponsored / introduced / was the primary sponsor of H.R. 1234" all parse to the same `introduce-01 :ARG0 Smith :ARG1 H.R. 1234`. SPO has to learn that "sponsored" and "introduced" mean the same thing.

### Where it matters in congress text

Sentences like these from `how-our-laws-are-made.md` are AMR-shaped, not SPO-shaped:

- *"The Speaker **may not** entertain a request to delete the name of the primary sponsor."*
  → modality (`:mode possible`) + negation (`:polarity -`) on a nested action.
- *"If the President fails to return it with objections within 10 days while Congress is in session, it becomes law."*
  → conditional (`:condition`), temporal window (`:duration "10 days"`), and a stacked precondition (`:condition (s / session :ARG0 Congress)`).
- *"Cosponsors' names may be deleted by their own unanimous-consent request or that of the primary sponsor."*
  → disjunction (`:op1 / :op2`) of two agents on the same delete action.

Today the SPO LLM either drops these or emits triples that lose half the meaning.

### Cost

AMR parsers (`amrlib`, `IBM transition-amr-parser`, `SPRING`) are 100–500 ms per sentence and noisier than NER+RE. The base case (§3.3) says use it on **a subset**: dense or modality-heavy sentences. Practical wiring would be a per-chunk "complexity gate" — if the SPO LLM emits a low-confidence triple AND the sentence has negation/modality markers, fall back to AMR for that sentence and re-emit propositions from the AMR graph.

---

## Temporal validity intervals

This is about the difference between **when a sentence was written** vs. **when the fact it states actually holds**.

### What we have today

Every `Assertion` carries:

```python
provenance.temporal_start_ms / temporal_end_ms   # ← when the CHUNK was authored
```

For an audio transcript that's the speaker timestamp; for a news article it's the publish date.

### What's missing

The proposition itself needs `[t_valid_from, t_valid_until]` — when the *fact* started being true and when it stopped being true. That's a different axis from chunk authorship.

### Why congress makes the distinction sharp

The congress entities in `catalyst-data/packages/congress-data/src/congress_data/entities.py` **already carry this information** — we just don't propagate it to the propositions:

```python
class Cosponsor(BaseModel):
    sponsorship_date: date | None    # ← t_valid_from
    withdrawn_date:   date | None    # ← t_valid_until
    is_original:      bool

class Term(BaseModel):
    bioguide_id: str
    congress:    int
    chamber:     str
    start_year:  int                 # ← t_valid_from
    end_year:    int                 # ← t_valid_until
    party:       str                 # ← validity-bounded!
    state:       str
    district:    str | None
```

So a fact like *"Sen. Schumer is the Democratic senator from New York"* should not be a flat proposition — it's only true during specific `Term` intervals. If Schumer switched parties (it happens), that proposition gets a closed interval and a new one opens.

### Concrete example

```python
# Today — what we emit
Assertion(
    subject_text="Rep. Smith",
    predicate="cosponsored",
    object_text="H.R. 1234",
    qualifiers={"time": "March 15, 2025"},   # ← free-text string, not queryable
    provenance=Provenance(
        temporal_start_ms=1714521600000,     # ← when the press release was written
    ),
)

# What we should emit
Assertion(
    subject_text="Rep. Smith",
    predicate="cosponsored",
    object_text="H.R. 1234",
    qualifiers={
        "t_valid_from":  "2025-03-15",       # ← stamped from Cosponsor.sponsorship_date
        "t_valid_until": "2025-04-02",       # ← stamped from Cosponsor.withdrawn_date
        "manner":        "original cosponsor",
    },
    provenance=Provenance(
        temporal_start_ms=1714521600000,     # ← still here, but for source provenance
    ),
)
```

Now a query like *"who cosponsored H.R. 1234 on 2025-03-20?"* is answerable — Smith is in, because `t_valid_from ≤ 2025-03-20 ≤ t_valid_until`. Today that query is impossible: we just know "Smith cosponsored, here's a date string we don't parse."

### Why it's bigger than just adding a field

Two flavors of proposition behave differently:

| Proposition type | Validity | Example |
|---|---|---|
| **Event** (instantaneous) | point-in-time, `t_valid_from == t_valid_until` | `H.R. 1234 passed_House on 2025-04-15` |
| **State** (durative) | open or closed interval | `Smith chairs_Committee Judiciary from 2025-01-03 until 2027-01-03` |
| **Atemporal** | `[−∞, +∞]` | `H.R. 1234 cites 5 U.S.C. § 552` |

The SPO prompt needs to learn which predicate is which type, OR the predicate vocab needs to encode it (e.g. `chaired_during` vs. `chairs`). The base case §4.3 hints at this with RDF-star: every assertion is a quoted triple, and the validity interval is attached *to the quoted triple*, not to the subject/object nodes.

### Wiring it in

Smallest viable step:

1. Add `t_valid_from`, `t_valid_until` to `Assertion.qualifiers` (or promote them to first-class fields).
2. For propositions emitted by **the SPO LLM**, add a `temporal_validity` schema slot the prompt fills when stated (the legislative text often gives it: *"effective January 1, 2026"*, *"for fiscal year 2025"*).
3. For propositions emitted from **structured entity data** (Cosponsor, Term, RollCallVote, PublicLaw.signed_date), stamp the interval deterministically from the entity fields — no LLM needed.
4. Mark **atemporal** predicates (`cites`, `amends`, `repeals`) with `t_valid_until = null` and `is_atemporal = true` so queries can skip the time filter.

---

## TL;DR

- **AMR** is the "use a real semantic parser instead of asking an LLM for triples" upgrade. Wins on negation, modality, conditionals, coreference, paraphrase normalization. Cost: 100–500 ms/sentence and an extra dependency. Apply selectively to complexity-flagged sentences, not blanket.
- **Temporal validity intervals** are the "tell me when the fact is true, not just when the article was written" upgrade. Most of the data (`sponsorship_date`, `start_year`, `withdrawn_date`) already exists in `congress_data/entities.py` — we just don't carry it onto the propositions. Cheap win.
