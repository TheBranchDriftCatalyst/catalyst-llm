"""Generic extraction node — parameterized by StageConfig.

Used by ``NerEnsembleNode`` (one ExtractNode per encoder in the
ensemble). Each ExtractNode calls ``client.structured_output()`` with the
schema + prompt from the StageConfig and writes candidates into
``state["stages"][config.stage_name]``.

The legacy SPO LLM stage was removed when the AMR-as-spine refactor
landed; this module is NER-only. The validate/repair loop is also gone —
encoder NER is deterministic (max_retries=0) and AMR projection
replaces SPO-style LLM retry semantics.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from catalyst_exgraph.config import StageConfig
from catalyst_exgraph.nodes._audit import make_audit_event
from catalyst_exgraph.nodes.spans import correct_candidate_spans
from catalyst_exgraph.protocol import ExtractionClient
from catalyst_exgraph.state import ExGraphState, ExGraphStatus

# Optional cross-repo audit-event store; no-op stub when dagster_io
# isn't installed (catalyst-langgraph's Docker image case).
try:
    from dagster_io import event_store  # type: ignore
except ImportError:
    class _NoopEventStore:
        def __getattr__(self, _name):
            return lambda *a, **kw: None
    event_store = _NoopEventStore()  # type: ignore

logger = logging.getLogger(__name__)


def _load_prompt(config: StageConfig) -> str:
    """Load a prompt from config.prompt_dir or fall back to PROMPT_REGISTRY_DIR env var."""
    from pathlib import Path

    if config.prompt_dir:
        prompt_path = Path(config.prompt_dir) / f"{config.prompt_id}.prompt"
        if prompt_path.is_file():
            from catalyst_langgraph.prompts import parse_prompt_file

            return parse_prompt_file(prompt_path, config.prompt_id).system_content

    from catalyst_langgraph.prompts import load_prompt

    return load_prompt(config.prompt_id, config.fallback_prompt)


class ExtractNode:
    """Generic extraction node — runs one encoder/LLM through structured_output().

    Used by NerEnsembleNode (one instance per encoder). The output lands
    in state["stages"][config.stage_name] with status="completed".
    """

    def __init__(self, config: StageConfig, client: ExtractionClient) -> None:
        self.config = config
        self.client = client

    async def __call__(self, state: ExGraphState) -> dict[str, Any]:
        raw_text = state.get("raw_text", "")
        stage_name = self.config.stage_name
        node_name = f"extract_{stage_name}"

        src = state.get("source_metadata") or {}
        chunk_id = state.get("chunk_id") or src.get("chunk_id")
        if chunk_id:
            event_store.emit_chunk_text(
                chunk_id,
                raw_text,
                doc_id=state.get("doc_id") or src.get("document_id"),
                model=state.get("model"),
                domain=src.get("domain"),
                speaker_label=src.get("speaker_label"),
                temporal_start_ms=src.get("temporal_start_ms"),
                temporal_end_ms=src.get("temporal_end_ms"),
                chunk_index=src.get("chunk_index"),
                total_chunks=src.get("total_chunks"),
                chunk_metadata=src.get("chunk_metadata") or {},
            )

        logger.info("%s: start, input_len=%d", node_name, len(raw_text))
        t0 = time.perf_counter()

        try:
            system = _load_prompt(self.config)
            messages = [SystemMessage(content=system), HumanMessage(content=raw_text)]
            result = await self.client.structured_output(self.config.extraction_schema, messages)

            candidates = []
            items = getattr(result, "mentions", None)
            if items is not None:
                candidates = [item.model_dump() for item in items]
            candidates = correct_candidate_spans(candidates, raw_text)

            elapsed = time.perf_counter() - t0
            logger.info("%s: done, candidates=%d, duration=%.3fs", node_name, len(candidates), elapsed)

            stages = dict(state.get("stages", {}))
            stages[stage_name] = {
                "candidates": candidates,
                "accepted": candidates,  # encoder output is final — no validate/repair loop
                "validation": {},
                "retry_count": 0,
                "status": "completed",
                "error": "",
            }

            return {
                "stages": stages,
                "status": ExGraphStatus.COMPLETED.value,
                "audit_events": state.get("audit_events", [])
                + [
                    make_audit_event(
                        node_name,
                        "completed",
                        state=state,
                        duration_s=elapsed,
                        candidate_count=len(candidates),
                    )
                ],
            }
        except Exception as e:
            elapsed = time.perf_counter() - t0
            logger.exception("%s failed", node_name)
            stages = dict(state.get("stages", {}))
            stages[stage_name] = {
                "candidates": [],
                "accepted": [],
                "validation": {},
                "retry_count": 0,
                "status": "error",
                "error": str(e),
            }
            return {
                "stages": stages,
                "status": ExGraphStatus.FAILED.value,
                "error": str(e),
                "audit_events": state.get("audit_events", [])
                + [make_audit_event(node_name, "error", state=state, duration_s=elapsed, error=str(e))],
            }
