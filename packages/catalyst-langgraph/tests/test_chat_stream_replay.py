"""SSE replay test for POST /api/chat/stream (llm-8i8).

Pins the typed AgentEvent wire shape against a recorded canonical
fixture. Any refactor that changes the SSE event sequence, the event
type discriminators, or the payload schema fails this test.

Complements test_chat_stream.py — that test asserts a handful of
specific properties (event types in expected order, key payload fields);
this one is a structural diff against the FULL captured output.

The fixture lives at tests/fixtures/chat_stream_canonical.json. To
regenerate after an intentional wire change, delete the file and
re-run pytest — the test will write a new fixture and pass on the
re-run. Commit the regenerated fixture intentionally.

Non-deterministic fields (run_id from uuid, duration_ms from
monotonic clock) are normalized before compare.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "chat_stream_canonical.json"


class _FakeOutputMsg:
    def __init__(self) -> None:
        self.response_metadata = {"finish_reason": "stop"}
        self.usage_metadata = {"input_tokens": 10, "output_tokens": 5}


class _FakeChunk:
    def __init__(self, content: str) -> None:
        self.content = content


def _scripted_events() -> list[dict[str, Any]]:
    """Deterministic LangGraph v2 event sequence. Mirrors the one in
    test_chat_stream.py — kept here too so the replay test is
    self-contained (only one consumer would have been DRY for nothing).
    """
    return [
        {"event": "on_chain_start", "name": "tools", "data": {}, "run_id": "r0"},
        {"event": "on_chat_model_stream", "name": "agent",
         "data": {"chunk": _FakeChunk("hello ")}, "run_id": "r1"},
        {"event": "on_chat_model_stream", "name": "agent",
         "data": {"chunk": _FakeChunk("world")}, "run_id": "r1"},
        {"event": "on_tool_start", "name": "web_search",
         "data": {"input": {"query": "anything"}}, "run_id": "tc1"},
        {"event": "on_tool_end", "name": "web_search",
         "data": {"output": ToolMessage(content="result", tool_call_id="x")},
         "run_id": "tc1"},
        {"event": "on_chat_model_stream", "name": "agent",
         "data": {"chunk": _FakeChunk("final ")}, "run_id": "r2"},
        {"event": "on_chat_model_stream", "name": "agent",
         "data": {"chunk": _FakeChunk("answer")}, "run_id": "r2"},
        {"event": "on_chat_model_end", "name": "agent",
         "data": {"output": _FakeOutputMsg()}, "run_id": "r2"},
    ]


class _FakeGraph:
    async def astream_events(
        self, _state, version: str = "v2", **kwargs
    ) -> AsyncIterator[dict]:
        for ev in _scripted_events():
            yield ev


def _parse_sse(body: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    event = None
    for line in body.splitlines():
        if line.startswith("event:"):
            event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            payload = json.loads(line[len("data:"):].strip())
            out.append({"event": event or payload.get("type", ""), "data": payload})
            event = None
    return out


def _normalize(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip fields that aren't reproducible run-to-run."""
    normalized = []
    for ev in events:
        data = dict(ev["data"])
        if "run_id" in data:
            data["run_id"] = "<run_id>"
        if "duration_ms" in data:
            data["duration_ms"] = "<duration_ms>"
        normalized.append({"event": ev["event"], "data": data})
    return normalized


@pytest.mark.unit
def test_chat_stream_replay_matches_canonical_fixture() -> None:
    """Run the scripted graph through the SSE pipeline and compare
    the normalized event stream against the canonical fixture.

    Regen protocol: delete tests/fixtures/chat_stream_canonical.json
    and re-run pytest; the test will write a new fixture and pass.
    Review the diff and commit deliberately.
    """
    from catalyst_langgraph.server import app

    with patch("catalyst_langgraph.server.build_graph", return_value=_FakeGraph()):
        client = TestClient(app)
        body = {
            "model": "fake/model",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": ["web_search"],
        }
        with client.stream("POST", "/api/chat/stream", json=body) as resp:
            assert resp.status_code == 200
            text = "".join(resp.iter_text())

    actual = _normalize(_parse_sse(text))

    if not FIXTURE_PATH.exists():
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_PATH.write_text(json.dumps(actual, indent=2) + "\n")
        pytest.skip(
            f"Wrote new fixture at {FIXTURE_PATH}. Review the diff and commit "
            "intentionally; the next run will compare against it."
        )

    expected = json.loads(FIXTURE_PATH.read_text())
    assert actual == expected, (
        "SSE event stream drift detected. If intentional, delete "
        f"{FIXTURE_PATH.name} and re-run pytest to regenerate. "
        f"Actual:\n{json.dumps(actual, indent=2)}"
    )
