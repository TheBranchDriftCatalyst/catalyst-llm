"""AmrParseNode — LangGraph wrapper around catalyst-langgraph's AmrParserClient.

The AMR parser client lives in catalyst-langgraph (alongside the other
extraction clients) but the pipeline orchestration that calls it lives
here. This node is the seam: it reads ``state["raw_text"]``, calls the
async ``parse()``, and writes ``state["amr_parses"]``.

Why a shim instead of calling the client directly from build_amr_pipeline:

  * Keeps the pipeline builder free of async/await — the client returns
    a coroutine; the node awaits it.
  * Gives the State Inspector a single named node to surface in the
    rail card (``amr_parse_started`` / ``amr_parse_completed`` events).
  * Lets the test suite stub the client at this layer (the projection
    node's tests use hand-built PENMAN; the pipeline integration tests
    use a real ``AmrParserClient`` instance with a stubbed parser).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from catalyst_exgraph.state import ExGraphState

try:
    from dagster_io import event_store  # type: ignore
except ImportError:
    class _NoopEventStore:
        def __getattr__(self, _name):
            return lambda *a, **kw: None

    event_store = _NoopEventStore()  # type: ignore

logger = logging.getLogger(__name__)


class AmrParseNode:
    """Pipeline node that parses ``state["raw_text"]`` to PENMAN.

    Args:
        client: An ``AmrParserClient`` instance (or any object exposing
            an async ``parse(text) -> list[AmrSentenceParse]``). Passing
            an explicit client at construction lets the resource layer
            pick the splitter + model checkpoint, and lets tests inject
            a stub.

    State contract:
        reads:
            state["raw_text"] : str
        writes:
            state["amr_parses"] : list[AmrSentenceParse]
            state["amr_audit_events"] : appended
    """

    def __init__(self, client: Any) -> None:
        self.client = client

    async def __call__(self, state: ExGraphState) -> dict[str, Any]:
        t0 = time.perf_counter()
        src = state.get("source_metadata") or {}
        doc_id = state.get("doc_id") or src.get("document_id") or ""
        chunk_id = state.get("chunk_id") or src.get("chunk_id") or f"{doc_id}:_amr_parse"
        raw_text = state.get("raw_text", "")

        event_store.append(
            source="amr_parse",
            node_name="amr_parse_started",
            status="started",
            doc_id=doc_id,
            chunk_id=chunk_id,
            details={"input_len": len(raw_text)},
        )

        existing_events = list(state.get("amr_audit_events") or [])

        if not raw_text.strip():
            elapsed = time.perf_counter() - t0
            logger.info("amr_parse: empty raw_text, skipping (duration=%.3fs)", elapsed)
            event_store.append(
                source="amr_parse",
                node_name="amr_parse_completed",
                status="completed",
                doc_id=doc_id,
                chunk_id=chunk_id,
                details={"n_sentences": 0, "n_errors": 0, "duration_s": elapsed},
            )
            return {
                "amr_parses": [],
                "amr_audit_events": existing_events + [
                    {
                        "node_name": "amr_parse_completed",
                        "status": "completed",
                        "n_sentences": 0,
                        "n_errors": 0,
                        "duration_s": elapsed,
                    }
                ],
            }

        try:
            parses = await self.client.parse(raw_text)
        except ImportError:
            # amrlib not installed — propagate. The whole client is unusable;
            # this isn't a per-sentence failure mode.
            raise
        except Exception as exc:  # noqa: BLE001 — node-level failure isolation
            elapsed = time.perf_counter() - t0
            err = f"{type(exc).__name__}: {exc}"
            logger.exception("amr_parse: client failed")
            event_store.append(
                source="amr_parse",
                node_name="amr_parse_completed",
                status="error",
                doc_id=doc_id,
                chunk_id=chunk_id,
                details={"error": err, "duration_s": elapsed},
            )
            return {
                "amr_parses": [],
                "amr_audit_events": existing_events + [
                    {
                        "node_name": "amr_parse_completed",
                        "status": "error",
                        "error": err,
                        "duration_s": elapsed,
                    }
                ],
            }

        parses_list = list(parses)
        n_errors = sum(1 for p in parses_list if getattr(p, "parse_error", None))
        elapsed = time.perf_counter() - t0
        logger.info(
            "amr_parse: %d sentences (%d errors) in %.3fs",
            len(parses_list),
            n_errors,
            elapsed,
        )
        event_store.append(
            source="amr_parse",
            node_name="amr_parse_completed",
            status="completed",
            doc_id=doc_id,
            chunk_id=chunk_id,
            details={
                "n_sentences": len(parses_list),
                "n_errors": n_errors,
                "duration_s": elapsed,
            },
        )

        return {
            "amr_parses": parses_list,
            "amr_audit_events": existing_events + [
                {
                    "node_name": "amr_parse_completed",
                    "status": "completed",
                    "n_sentences": len(parses_list),
                    "n_errors": n_errors,
                    "duration_s": elapsed,
                }
            ],
        }
