"""End-to-end AMR-spine extraction MVP on a congressional sentence.

Demonstrates the full pipeline for the greenfield AMR-as-spine architecture:

    chunk text
      → NER ensemble (RegexNerClient against the congress label pack)
      → consensus mentions
      → AMR parser  (stubbed here with hand-built PENMAN — amrlib not
                     required for the demo; the dev's tests use the
                     same stub pattern)
      → AmrToAssertionNode (real, walks the PENMAN graph, applies the
                            congress AMR-frame mapping + role_overrides)
      → list[catalyst_contracts_core.Assertion] printed to stdout

To run from the workspace root::

    cd packages/catalyst-exgraph
    uv run python examples/amr_congress_mvp.py

The PENMAN graph was hand-written to represent the sentence:

    "Rep. Smith introduced H.R. 1234, which was referred to the
     Committee on Energy and Commerce, but the bill was never reported."

It exercises:
  * Two predicate frames (``introduce-01`` → ``sponsors``, ``refer-01`` →
    ``refers_to``) — both in the congress pack's frame table after the
    QA-B predicate-vocab rename.
  * Reentrancy on the bill node ``b`` (referenced as the object of
    introduce-01 AND as the argument of the refer relation).
  * Polarity on a nested ``report-01`` (``:polarity -``) to demonstrate
    the negated-assertion path — this corresponds to the
    "but the bill was never reported" clause.
  * Real consensus mentions from the regex voter resolving the bill
    citation to a canonical entity reference.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from langchain_core.messages import HumanMessage

from catalyst_exgraph.models.extraction_output import MentionExtractionResult
from catalyst_exgraph.nodes.amr_project import AmrToAssertionNode
from catalyst_langgraph.clients.regex_ner import RegexNerClient
from catalyst_langgraph.label_packs import load_label_pack

# Hand-built PENMAN for the demo sentence. Mirrors the AMR a real parser
# would emit; sentence_char_* fields are computed at runtime against the
# chunk text below.
_DEMO_PENMAN = """
(i / introduce-01
   :ARG0 (p / person
            :name (n / name :op1 "Rep." :op2 "Smith"))
   :ARG1 (b / bill
            :name (n2 / name :op1 "H.R." :op2 "1234")
            :ARG1-of (r / refer-01
                        :ARG2 (c / committee
                                 :name (n3 / name :op1 "Committee"
                                              :op2 "on" :op3 "Energy"
                                              :op4 "and" :op5 "Commerce")))
            :ARG1-of (rep / report-01
                        :polarity -
                        :ARG0 c)))
""".strip()

_CHUNK = (
    "Rep. Smith introduced H.R. 1234, which was referred to the "
    "Committee on Energy and Commerce, but the bill was never reported."
)

_CONGRESS_PACK_DIR = (
    "/Users/panda/catalyst-devspace/workspace/catalyst-data/"
    "k8s/base/congress-data/prompts"
)


@dataclass(frozen=True)
class _StubParse:
    """Minimal AmrSentenceParse-shaped stub for the demo.

    The real parser would emit a list of these. We hand-build one record
    here because amrlib + 500MB of model weights aren't required to
    demonstrate the projection layer.
    """

    sentence_text: str
    sentence_index: int
    sentence_char_start: int
    sentence_char_end: int
    penman: str
    parse_duration_s: float = 0.0
    parse_error: str | None = None


async def main() -> None:
    print("=" * 72)
    print("AMR-spine extraction MVP — congressional sentence")
    print("=" * 72)
    print()
    print(f"CHUNK ({len(_CHUNK)} chars):")
    print(f"  {_CHUNK}")
    print()

    # 1. Load the congress label pack (post QA-B + QA-C fixes).
    pack = load_label_pack(_CONGRESS_PACK_DIR, "congress")
    print(f"Label pack:        {pack.name} (domain={pack.domain})")
    print(f"  canonical_types: {len(pack.canonical_types)} "
          f"({', '.join(pack.canonical_types[:5])}, ...)")
    print(f"  AMR frames:      {len(pack.amr_frames.frames)} mapped, "
          f"action={pack.amr_frames.unknown_frame_action}")
    extended = getattr(pack.amr_frames, "extended_predicates", []) or []
    print(f"  extended preds:  {len(extended)}")
    print()

    # 2. NER ensemble — for the MVP we use the regex voter only (the
    # other three need GPU / Ollama). Regex carries confidence=1.0 and
    # is authoritative for BILL / PUBLIC_LAW / AMENDMENT etc.
    print("─── Stage 1: NER ensemble (regex voter, demo) ───────────────────────")
    regex_client = RegexNerClient(label_pack=pack)
    ner_result = await regex_client.structured_output(
        MentionExtractionResult,
        [HumanMessage(content=_CHUNK)],
    )
    consensus_mentions = []
    for i, m in enumerate(ner_result.mentions):
        mention_id = f"m-{i:03d}"
        consensus_mentions.append(
            {
                "mention_id": mention_id,
                "text": m.text,
                "canonical_type": m.mention_type,
                "span_start": m.span_start,
                "span_end": m.span_end,
                "confidence": m.confidence,
            }
        )
        print(
            f"  [{m.span_start:>3d}:{m.span_end:<3d}] "
            f"{m.text!r:30s} {m.mention_type:<18s} conf={m.confidence}  "
            f"id={mention_id}"
        )
    if not consensus_mentions:
        print("  (regex voter found nothing — the demo sentence may need "
              "the model voters)")
    print()

    # 3. Stub the AMR parser output. The penman string represents what
    # amrlib would emit for the demo sentence.
    print("─── Stage 2: AMR parse (stubbed PENMAN) ─────────────────────────────")
    parses = [
        _StubParse(
            sentence_text=_CHUNK,
            sentence_index=0,
            sentence_char_start=0,
            sentence_char_end=len(_CHUNK),
            penman=_DEMO_PENMAN,
        )
    ]
    print(f"  1 sentence parsed → {len(_DEMO_PENMAN)} chars of PENMAN")
    print()

    # 4. AMR-to-assertion projection — the real node, walks the PENMAN,
    # applies frame lookup + role_overrides, resolves AMR vars against
    # consensus mentions, emits unified Assertions (contracts-core).
    print("─── Stage 3: AmrToAssertionNode (real) ──────────────────────────────")
    node = AmrToAssertionNode(label_pack=pack)
    state = {
        "raw_text": _CHUNK,
        "amr_parses": parses,
        "consensus_mentions": consensus_mentions,
        "source_metadata": {
            "document_id": "hdb-laws-made-2008",
            "chunk_id": "demo-chunk-001",
        },
    }
    result = await node(state)
    assertions = result.get("amr_assertions", [])
    print(f"  → {len(assertions)} Assertion(s) emitted")
    print()

    # 5. Print each assertion in a readable format.
    print("─── Output: Assertions ──────────────────────────────────────────────")
    for i, a in enumerate(assertions, 1):
        pol = "─" if not a.polarity else "+"
        mod = f" mode={a.modality}" if a.modality else ""
        novel = " [NOVEL]" if a.is_novel_predicate else ""
        print(
            f"  [{i}] {a.subject_text!r:30s} "
            f"--{a.predicate}{pol}-->  "
            f"{a.object_text!r}  "
            f"(frame={a.amr_frame}, conf={a.confidence}{mod}){novel}"
        )
        if a.qualifiers:
            for k, v in a.qualifiers.items():
                print(f"       qualifier  {k:<22s}= {v!r}")
        if a.subject_mention_id:
            print(f"       subject-mention-id      = {a.subject_mention_id}")
        if a.object_mention_id:
            print(f"       object-mention-id       = {a.object_mention_id}")
    print()
    print("─── Summary ─────────────────────────────────────────────────────────")
    n_neg = sum(1 for a in assertions if not a.polarity)
    n_novel = sum(1 for a in assertions if a.is_novel_predicate)
    print(f"  total assertions: {len(assertions)}")
    print(f"  negated:          {n_neg}")
    print(f"  novel predicates: {n_novel}")
    print(f"  audit events:     {len(result.get('amr_audit_events', []))}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
