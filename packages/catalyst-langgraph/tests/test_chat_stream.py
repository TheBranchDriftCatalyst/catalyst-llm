"""Unit tests for POST /api/chat/stream.

Strategy: monkeypatch build_graph to return a fake compiled graph whose
astream_events yields a hand-rolled sequence of LangGraph v2 events.
This lets us assert the translation layer in server._stream_agent_events
without booting a real LLM or tool-host.

Live SSE behavior is exercised in tests/test_chat_stream_live.py
(written next, gated on env).
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage


def _parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    """Decode an SSE response body into [(event_name, payload_dict), …]."""
    out: list[tuple[str, dict[str, Any]]] = []
    event = None
    for line in body.splitlines():
        if line.startswith("event:"):
            event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            payload = json.loads(line[len("data:"):].strip())
            out.append((event or payload.get("type", ""), payload))
            event = None
    return out


class _FakeOutputMsg:
    """Stand-in for an AIMessage with response_metadata + usage_metadata."""
    def __init__(self) -> None:
        self.response_metadata = {"finish_reason": "stop"}
        self.usage_metadata = {"input_tokens": 10, "output_tokens": 5}


class _FakeChunk:
    def __init__(self, content: str) -> None:
        self.content = content


def _scripted_events() -> list[dict[str, Any]]:
    """LangGraph v2 events covering: tool-loop entry, two token chunks,
    a tool start/end, two more tokens, model end. Exercises every
    branch of the translator."""
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
    async def astream_events(self, _state, version: str = "v2", **kwargs) -> AsyncIterator[dict]:
        for ev in _scripted_events():
            yield ev


@pytest.mark.unit
def test_chat_stream_emits_full_event_sequence() -> None:
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

    events = _parse_sse(text)
    types = [e[0] for e in events]
    assert types[0] == "run_started"
    assert "iteration" in types
    assert types.count("token") == 4  # "hello ", "world", "final ", "answer"
    assert "tool_call_start" in types
    assert "tool_call_end" in types
    assert types[-1] == "message_done"

    # Spot-check payload shapes
    started = next(p for t, p in events if t == "run_started")
    assert started["model"] == "fake/model"
    tool_start = next(p for t, p in events if t == "tool_call_start")
    assert tool_start["name"] == "web_search"
    assert tool_start["args"] == {"query": "anything"}
    tool_end = next(p for t, p in events if t == "tool_call_end")
    assert tool_end["result"] == "result"
    assert tool_end["duration_ms"] >= 0
    done = next(p for t, p in events if t == "message_done")
    assert done["finish_reason"] == "stop"
    assert done["usage"]["output_tokens"] == 5


@pytest.mark.unit
def test_chat_stream_handles_graph_build_failure() -> None:
    """If build_graph throws, the stream should still open and emit a
    single error event rather than 500'ing the request."""
    from catalyst_langgraph.server import app

    def boom(**_kw):
        raise RuntimeError("nope")

    with patch("catalyst_langgraph.server.build_graph", side_effect=boom):
        client = TestClient(app)
        body = {
            "model": "fake/model",
            "messages": [{"role": "user", "content": "hi"}],
        }
        with client.stream("POST", "/api/chat/stream", json=body) as resp:
            assert resp.status_code == 200
            text = "".join(resp.iter_text())

    events = _parse_sse(text)
    types = [e[0] for e in events]
    assert "run_started" in types
    assert "error" in types
    err = next(p for t, p in events if t == "error")
    assert "nope" in err["message"]
