"""Unit tests for the agent graph.

We mock the LLM (no real LiteLLM calls) and tool-host (no real httpx
calls) and assert the message thread shape after the graph runs to a
final state. This proves the wiring — agent → tools → agent loop with
ToolNode + tools_condition — without touching the network.

Real model / real tool-host smoke tests live in tests/test_smoke_live.py
(written next; gated on env vars so unit runs stay offline).
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage


@pytest.mark.unit
def test_graph_no_tools_runs_single_agent_call() -> None:
    """Graph with tool_names=None should reach END after one LLM call."""
    from catalyst_langgraph.graph import build_graph

    fake_response = AIMessage(content="hi back")

    class FakeLLM:
        def invoke(self, messages):
            return fake_response

    with patch(
        "catalyst_langgraph.graph.CatalystLiteLLMClient"
    ) as MockClient:
        MockClient.return_value.get_chat_model.return_value = FakeLLM()

        app = build_graph(model="fake/model", tool_names=None)
        result = app.invoke({"messages": [HumanMessage(content="hi")]})

    msgs = result["messages"]
    assert len(msgs) == 2
    assert isinstance(msgs[-1], AIMessage)
    assert msgs[-1].content == "hi back"


@pytest.mark.unit
def test_graph_with_tool_loops_until_no_more_tool_calls() -> None:
    """Wire a fake LLM that emits one tool call, then a final answer.
    The graph should call the tool, append its result, re-enter the
    agent, and finish with a content-only AIMessage."""
    from catalyst_langgraph.graph import build_graph

    # Two-step LLM script: first turn requests a tool, second turn answers.
    tool_call_msg = AIMessage(
        content="",
        tool_calls=[
            {
                "id": "call_1",
                "name": "web_search",
                "args": {"query": "anything"},
            }
        ],
    )
    final_msg = AIMessage(content="all done")

    call_count = {"n": 0}

    class FakeLLM:
        def bind_tools(self, _tools):
            return self

        def invoke(self, _messages):
            call_count["n"] += 1
            return tool_call_msg if call_count["n"] == 1 else final_msg

    # web_search lives behind tool-host; mock the httpx client so the
    # @tool wrapper returns a deterministic string.
    fake_resp = type(
        "R",
        (),
        {
            "raise_for_status": lambda self: None,
            "json": lambda self: {
                "results": [
                    {
                        "title": "T",
                        "url": "http://example.com",
                        "snippet": "S",
                    }
                ]
            },
        },
    )()

    class FakeHttpxClient:
        def __init__(self, *a, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **kw): return fake_resp

    with patch(
        "catalyst_langgraph.graph.CatalystLiteLLMClient"
    ) as MockClient, patch(
        "catalyst_langgraph.tools.host.httpx.Client", FakeHttpxClient
    ):
        MockClient.return_value.get_chat_model.return_value = FakeLLM()

        app = build_graph(model="fake/model", tool_names=["web_search"])
        result = app.invoke({"messages": [HumanMessage(content="search please")]})

    msgs = result["messages"]
    # Expect: human → tool-call AIMessage → ToolMessage(result) → final AIMessage
    assert len(msgs) == 4
    assert isinstance(msgs[1], AIMessage) and msgs[1].tool_calls
    assert isinstance(msgs[2], ToolMessage) and "example.com" in msgs[2].content
    assert isinstance(msgs[3], AIMessage) and msgs[3].content == "all done"
    # Confirm the loop ran exactly twice (tool-call turn + final turn)
    assert call_count["n"] == 2
