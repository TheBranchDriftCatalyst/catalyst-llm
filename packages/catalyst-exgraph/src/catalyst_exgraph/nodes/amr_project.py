"""AmrToAssertionNode — project parsed AMR graphs into unified Assertions.

For every predicate node in every parsed sentence:
  - Look up the PropBank frame in ``pack.amr_frames.frames``.
  - Read ``:polarity`` / ``:mode`` / ``:time`` / ``:location`` /
    ``:condition`` / ``:manner``.
  - Apply ``role_overrides`` if the frame has them (else default
    ``{ARG0: "subject", ARG1: "object"}``).
  - Resolve AMR variables (concepts under each ARG edge) against the NER
    consensus mentions for span anchoring + mention id linking.
  - Emit one ``catalyst_contracts_core.Assertion`` per predicate node,
    with ``Provenance`` stamped from the source chunk + sentence range.

Sentences with ``parse_error`` set are skipped — the parser already
recorded the failure on the ``AmrSentenceParse`` record. An audit event
is emitted so the State Inspector still surfaces the skip.

State contract (LangGraph node):
    reads:
        state["amr_parses"]            : list[AmrSentenceParse]
        state["consensus_mentions"]    : list[ConsensusMention]
        state["raw_text"]              : str
        state["source_metadata"]       : dict (document_id, chunk_id)
    writes:
        state["amr_assertions"]        : list[Assertion]
        state["amr_audit_events"]      : list[dict]
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from typing import Any

import penman
from catalyst_contracts_core import Assertion, ExtractionMethod, Provenance

from catalyst_exgraph.state import ExGraphState
from catalyst_langgraph.label_packs.loader import LabelPack

# Optional cross-repo audit-event store; catalyst-langgraph's Docker
# image doesn't ship dagster_io. Mirrors the pattern in nodes/consensus.py:
# we keep the call sites uniform by stubbing the module with a no-op.
try:
    from dagster_io import event_store  # type: ignore
except ImportError:
    class _NoopEventStore:
        def __getattr__(self, _name):
            return lambda *a, **kw: None

    event_store = _NoopEventStore()  # type: ignore

logger = logging.getLogger(__name__)

# PropBank frame pattern — e.g. introduce-01, have-org-role-91. Used to
# decide which :instance concepts are predicates (vs. bare nouns like
# "person", "bill").
_FRAME_RE = re.compile(r"^[a-z][a-z-]*-\d+$")

# Adjunct roles projected to AmrAssertion.qualifiers. The leading colon
# is preserved here because penman returns roles as ":time" etc.
_QUALIFIER_ROLES = (":time", ":location", ":condition", ":manner")

# Default role mapping when the frame has no role_overrides entry. Most
# PropBank frames use ARG0=subject, ARG1=object.
_DEFAULT_ROLE_MAPPING: dict[str, str] = {"ARG0": "subject", "ARG1": "object"}

# Confidence floors per unknown_frame_action — known frames get 1.0,
# passthrough/novel get 0.5 so downstream consumers can rank them lower.
_CONFIDENCE_KNOWN = 1.0
_CONFIDENCE_UNKNOWN = 0.5

# Predicates that are atemporal — the relationship holds independently of
# when it's observed. When projection emits one of these, stamp
# is_atemporal=True so downstream point-in-time queries skip the time-
# window filter. Conservative closed set: only predicates whose semantics
# are purely structural / citational, not eventful or stateful.
#
# - cites / references: textual cross-reference, holds forever once written
# - amends / repeals / supersedes: legal-text edit relationship, not an event
# - codified_at: a bill's codification position in U.S.C., a structural fact
#
# A bd `llm-mln` follow-up may extend this with predicate-specific validity
# windows (e.g. "amends" *was* valid from amendment-date until next-edit-date),
# but the current floor is "atemporal == query without a time filter".
_ATEMPORAL_PREDICATES: frozenset[str] = frozenset({
    "cites",
    "references",
    "amends",
    "repeals",
    "supersedes",
    "codified_at",
})


class AmrToAssertionNode:
    """Walks AMR PENMAN graphs and projects them to AmrAssertions."""

    def __init__(self, label_pack: LabelPack) -> None:
        self.label_pack = label_pack

    async def __call__(self, state: ExGraphState) -> dict[str, Any]:
        t0 = time.perf_counter()
        src = state.get("source_metadata") or {}
        doc_id = state.get("doc_id") or src.get("document_id") or ""
        chunk_id = state.get("chunk_id") or src.get("chunk_id") or f"{doc_id}:_amr"

        amr_parses: list[Any] = list(state.get("amr_parses") or [])
        consensus_mentions: list[dict] = list(state.get("consensus_mentions") or [])

        amr_frames = self.label_pack.amr_frames
        frames_table = amr_frames.frames
        unknown_action = amr_frames.unknown_frame_action
        role_overrides = amr_frames.role_overrides

        assertions: list[Assertion] = []
        audit_events: list[dict[str, Any]] = []

        # Pack name flows into Provenance.extraction_model so the lineage
        # records "amr+<pack_name>" — useful for cross-pack auditing.
        pack_name = getattr(self.label_pack, "name", "") or "generic"

        event_store.append(
            source="amr_project",
            node_name="amr_projection_started",
            status="started",
            doc_id=doc_id,
            chunk_id=chunk_id,
            details={
                "n_sentences": len(amr_parses),
                "n_consensus_mentions": len(consensus_mentions),
                "unknown_frame_action": unknown_action,
                "n_known_frames": len(frames_table),
            },
        )

        n_parsed = 0
        n_parse_errors = 0
        n_predicates = 0
        n_dropped = 0
        n_novel = 0
        n_passthrough = 0

        for parse in amr_parses:
            sent_index = getattr(parse, "sentence_index", 0)
            sent_start = getattr(parse, "sentence_char_start", 0)
            sent_end = getattr(parse, "sentence_char_end", 0)
            sent_text = getattr(parse, "sentence_text", "")
            parse_error = getattr(parse, "parse_error", None)
            penman_str = getattr(parse, "penman", "") or ""

            if parse_error:
                n_parse_errors += 1
                audit_events.append(
                    {
                        "node_name": "amr_sentence_skipped",
                        "status": "skipped",
                        "sentence_index": sent_index,
                        "reason": "parse_error",
                        "parse_error": parse_error,
                    }
                )
                event_store.append(
                    source="amr_project",
                    node_name="amr_sentence_skipped",
                    status="skipped",
                    doc_id=doc_id,
                    chunk_id=chunk_id,
                    details={
                        "sentence_index": sent_index,
                        "reason": "parse_error",
                        "parse_error": parse_error,
                    },
                )
                continue

            if not penman_str.strip():
                # No graph but also no recorded error — defensive skip.
                continue

            try:
                graph = penman.decode(penman_str)
            except Exception as exc:  # noqa: BLE001 — graph-level decode failure
                n_parse_errors += 1
                err_msg = f"{type(exc).__name__}: {exc}"
                logger.warning(
                    "amr_project: decode failed for sentence %d: %s",
                    sent_index,
                    err_msg,
                )
                audit_events.append(
                    {
                        "node_name": "amr_decode_failed",
                        "status": "error",
                        "sentence_index": sent_index,
                        "error": err_msg,
                    }
                )
                event_store.append(
                    source="amr_project",
                    node_name="amr_decode_failed",
                    status="error",
                    doc_id=doc_id,
                    chunk_id=chunk_id,
                    details={
                        "sentence_index": sent_index,
                        "error": err_msg,
                    },
                )
                continue

            n_parsed += 1
            # Build var → concept index once per sentence.
            var_to_concept = {t.source: t.target for t in graph.instances()}

            for inst in graph.instances():
                concept = inst.target
                if not _FRAME_RE.match(concept):
                    continue
                n_predicates += 1
                predicate_var = inst.source

                # Resolve canonical predicate. An empty / whitespace-only
                # mapping in the frames table is a pack pathology — we
                # treat it the same as an unknown frame (audit + fall
                # through to unknown_frame_action) so empty predicates
                # never leak into the assertions list.
                mapped = frames_table.get(concept)
                if mapped is not None and mapped.strip():
                    canonical_predicate = mapped
                    confidence = _CONFIDENCE_KNOWN
                    is_novel = False
                else:
                    if mapped is not None:
                        # Frame is present in the table but mapped to "".
                        audit_events.append(
                            {
                                "node_name": "amr_frame_empty_mapping",
                                "status": "warning",
                                "sentence_index": sent_index,
                                "amr_frame": concept,
                                "reason": "frame maps to empty string in pack",
                            }
                        )
                        event_store.append(
                            source="amr_project",
                            node_name="amr_frame_empty_mapping",
                            status="warning",
                            doc_id=doc_id,
                            chunk_id=chunk_id,
                            details={
                                "sentence_index": sent_index,
                                "amr_frame": concept,
                            },
                        )
                    if unknown_action == "drop":
                        n_dropped += 1
                        audit_events.append(
                            {
                                "node_name": "amr_frame_dropped",
                                "status": "dropped",
                                "sentence_index": sent_index,
                                "amr_frame": concept,
                                "reason": "unknown_frame_action=drop",
                            }
                        )
                        event_store.append(
                            source="amr_project",
                            node_name="amr_frame_dropped",
                            status="dropped",
                            doc_id=doc_id,
                            chunk_id=chunk_id,
                            details={
                                "sentence_index": sent_index,
                                "amr_frame": concept,
                            },
                        )
                        continue
                    if unknown_action == "passthrough":
                        canonical_predicate = concept
                        is_novel = False
                        n_passthrough += 1
                    else:  # novel
                        canonical_predicate = f"NOVEL_{concept}"
                        is_novel = True
                        n_novel += 1
                    confidence = _CONFIDENCE_UNKNOWN

                # Apply per-frame role overrides if any, else default.
                role_mapping = dict(role_overrides.get(concept, _DEFAULT_ROLE_MAPPING))

                # Collect outgoing edges + attributes from this predicate.
                # NOTE on inverted edges: penman.decode() normalises
                # ``:ARG0-of`` etc. into forward ``:ARGn`` edges from the
                # nested predicate, so this enumeration DOES capture the
                # inverted-edge case — the inverted form is just syntactic
                # sugar in PENMAN. The projection is predicate-centric:
                # whatever ARGs the predicate node bears (whether written
                # forward or inverted in the source) end up as triples.
                out_edges = list(graph.edges(source=predicate_var))
                out_attrs = list(graph.attributes(source=predicate_var))

                # Polarity / modality from attributes.
                polarity = True
                modality: str | None = None
                for attr in out_attrs:
                    if attr.role == ":polarity" and attr.target == "-":
                        polarity = False
                    elif attr.role == ":mode":
                        modality = _strip_amr_literal(attr.target)

                # Role-mapped arg slots — collected by ARG name.
                arg_targets: dict[str, str] = {}
                for edge in out_edges:
                    if edge.role.startswith(":ARG"):
                        arg_name = edge.role.lstrip(":")  # ":ARG0" → "ARG0"
                        arg_targets[arg_name] = edge.target

                subject_text = ""
                object_text: str | None = None
                qualifiers: dict[str, str] = {}
                applied_role_mapping: dict[str, str] = {}
                subject_mention_id: str | None = None
                object_mention_id: str | None = None
                # SPO grounding flags — True means the role resolved to a
                # named entity or concept, False means we fell back to the
                # bare AMR variable (no semantic content). The emit guard
                # below drops rows whose subject didn't ground; those are
                # pure parser noise.
                subject_grounded = False
                object_grounded = False
                subject_role_present = False
                object_role_present = False

                for arg_name, semantic_role in role_mapping.items():
                    target_var = arg_targets.get(arg_name)
                    if target_var is None:
                        continue
                    applied_role_mapping[arg_name] = semantic_role
                    surface, grounded = _resolve_surface(graph, target_var, var_to_concept)
                    ent_id = _match_consensus(
                        surface,
                        consensus_mentions,
                        sent_start,
                        sent_end,
                    )
                    if semantic_role == "subject":
                        subject_text = surface
                        subject_grounded = grounded
                        subject_role_present = True
                        if ent_id:
                            subject_mention_id = ent_id
                    elif semantic_role == "object":
                        object_text = surface
                        object_grounded = grounded
                        object_role_present = True
                        if ent_id:
                            object_mention_id = ent_id
                    else:
                        # Custom semantic role from role_overrides — store
                        # as a qualifier rather than silently dropping it.
                        # Bare-var resolutions still get stored (a
                        # qualifier with the variable name is still a
                        # debug-useful hint).
                        qualifiers[semantic_role] = surface

                # Adjunct edges (time/location/condition/manner) → qualifiers.
                for edge in out_edges:
                    if edge.role in _QUALIFIER_ROLES:
                        key = edge.role.lstrip(":")
                        surface, _grounded = _resolve_surface(
                            graph, edge.target, var_to_concept
                        )
                        if surface:
                            qualifiers[key] = surface

                # ── SPO grounding guard ────────────────────────────────
                # Three flavours of noise we drop here:
                #
                # 1. Both subject AND object are empty / un-resolved.
                #    The frame had no ARG slots that landed on anything
                #    meaningful — pure parser noise. Intransitive
                #    frames where the subject is missing but the object
                #    grounded (e.g. "bill becomes law") still emit.
                # 2. Subject role WAS mapped but only resolved to the
                #    bare AMR variable name like "p2" / "v1" (no
                #    :name, no :instance). Drop.
                # 3. Same for the object role — if it was supposed to
                #    ground and didn't, drop. Frames with no object
                #    role at all (truly intransitive) still emit.
                obj_present = bool(object_text and object_text.strip())
                subj_present = bool(subject_text.strip())
                if not subj_present and not obj_present:
                    continue
                if subject_role_present and not subject_grounded:
                    continue
                if object_role_present and not object_grounded:
                    continue

                # Stable assertion id — md5 of canonical SPO + chunk + sentence_index.
                # 16 hex chars is plenty for in-flight dedup; concordance will mint
                # a longer canonical id post-resolution.
                assertion_id = hashlib.md5(
                    f"{subject_text}|{canonical_predicate}|{object_text or ''}"
                    f"|{chunk_id}|{sent_index}".encode()
                ).hexdigest()[:16]

                assertion = Assertion(
                    assertion_id=assertion_id,
                    subject_text=subject_text,
                    predicate=canonical_predicate,
                    object_text=object_text if object_text else None,
                    subject_mention_id=subject_mention_id,
                    object_mention_id=object_mention_id,
                    amr_frame=concept,
                    amr_variable=predicate_var,
                    amr_role_mapping=applied_role_mapping,
                    is_novel_predicate=is_novel,
                    is_atemporal=canonical_predicate in _ATEMPORAL_PREDICATES,
                    polarity=polarity,
                    modality=modality,
                    negated=not polarity,
                    qualifiers=qualifiers,
                    sentence_index=sent_index,
                    sentence_char_start=sent_start,
                    sentence_char_end=sent_end,
                    confidence=confidence,
                    provenance=Provenance(
                        source_document_id=src.get("document_id", "") or doc_id,
                        chunk_id=src.get("chunk_id", "") or chunk_id,
                        span_start=sent_start,
                        span_end=sent_end,
                        # AMR projection is a deterministic graph walk over a
                        # parsed PENMAN tree against a pack's frame table —
                        # distinct from STRUCTURED (LLM structured output) and
                        # from REGEX. The pack id is appended on
                        # extraction_model below so cross-pack auditing still
                        # works.
                        extraction_method=ExtractionMethod.AMR_PROJECTION,
                        extraction_model=f"amr_projection+{pack_name}",
                        confidence=confidence,
                        code_location="",  # caller stamps this downstream
                    ),
                )
                assertions.append(assertion)

            # Sentence-level audit event for trace continuity.
            audit_events.append(
                {
                    "node_name": "amr_sentence_projected",
                    "status": "completed",
                    "sentence_index": sent_index,
                    "sentence_text": sent_text[:200],
                    "predicate_count": sum(
                        1 for i in graph.instances() if _FRAME_RE.match(i.target)
                    ),
                }
            )

        elapsed = time.perf_counter() - t0

        event_store.append(
            source="amr_project",
            node_name="amr_projection_completed",
            status="completed",
            doc_id=doc_id,
            chunk_id=chunk_id,
            details={
                "n_sentences": len(amr_parses),
                "n_parsed": n_parsed,
                "n_parse_errors": n_parse_errors,
                "n_predicates_seen": n_predicates,
                "n_assertions": len(assertions),
                "n_dropped": n_dropped,
                "n_novel": n_novel,
                "n_passthrough": n_passthrough,
                "duration_s": round(elapsed, 4),
            },
        )

        logger.info(
            "amr_project: %d sentences, %d parse-errors, %d predicates, "
            "%d assertions emitted (novel=%d, passthrough=%d, dropped=%d) in %.3fs",
            len(amr_parses),
            n_parse_errors,
            n_predicates,
            len(assertions),
            n_novel,
            n_passthrough,
            n_dropped,
            elapsed,
        )

        return {
            "amr_assertions": assertions,
            "amr_audit_events": audit_events,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_amr_literal(value: str) -> str:
    """AMR string literals come out of penman with surrounding quotes intact.

    ``"H.R."`` → ``H.R.``  ;  bare atoms (``imperative``) pass through.
    """
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def _resolve_surface(
    graph: penman.Graph,
    var: str,
    var_to_concept: dict[str, str],
) -> tuple[str, bool]:
    """Resolve an AMR variable to a human-readable surface form.

    Returns ``(surface, grounded)`` where ``grounded`` is True when the
    resolution found a named-entity span (step 1) or an instance
    concept (step 2). False when we fell through to the bare AMR
    variable (step 3) — these rows carry no semantic content and the
    caller should typically drop them rather than emit a triple where
    the subject is literally ``"p2"`` or ``"v1"``.

    Resolution order:
      1. Walk to a ``:name`` edge and concatenate its ``:opN`` attributes
         (this is AMR's canonical entity-naming pattern, e.g.
         ``(p / person :name (n / name :op1 "Rep." :op2 "Smith"))``).
      2. Fall back to the variable's ``:instance`` concept (e.g. ``"bill"``).
      3. Return the variable name itself as a last resort.
    """
    # 1) :name → :op1 :op2 ...
    name_targets = [e.target for e in graph.edges(source=var, role=":name")]
    for name_var in name_targets:
        ops: list[tuple[int, str]] = []
        for attr in graph.attributes(source=name_var):
            if attr.role.startswith(":op"):
                try:
                    idx = int(attr.role[3:])
                except ValueError:
                    idx = 0
                ops.append((idx, _strip_amr_literal(attr.target)))
        if ops:
            ops.sort()
            return " ".join(piece for _, piece in ops), True

    # 2) :instance concept
    concept = var_to_concept.get(var)
    if concept:
        return concept, True

    # 3) bare var — no semantic surface, caller should drop.
    return var, False


def _match_consensus(
    surface: str,
    consensus_mentions: list[dict],
    sent_start: int,
    sent_end: int,
) -> str | None:
    """Return a canonical entity id matching ``surface`` inside the sentence's
    character range, or ``None`` if no consensus mention matches.

    Matching is case-insensitive substring on the consensus mention text;
    the consensus mention's span must overlap the sentence's char range so
    a mention from a different sentence in the same chunk doesn't bleed in.
    The returned id is the ConsensusMention's ``mention_id`` field.
    """
    if not surface:
        return None
    needle = surface.lower().strip()
    if not needle:
        return None
    for m in consensus_mentions:
        text = (m.get("text") or "").lower().strip()
        if not text:
            continue
        # Sentence-scoped span filter; defensive .get for synthetic test
        # mentions that may not carry spans.
        m_start = m.get("span_start")
        m_end = m.get("span_end")
        if m_start is not None and m_end is not None:
            if m_end <= sent_start or m_start >= sent_end:
                continue
        if needle == text or needle in text or text in needle:
            mid = m.get("mention_id")
            if mid:
                return str(mid)
    return None
