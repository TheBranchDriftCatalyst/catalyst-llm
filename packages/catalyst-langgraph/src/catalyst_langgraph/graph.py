"""LangGraph StateGraph for the Catalyst agent loop.

Two nodes — `agent` (LLM call) and `tools` (ToolNode) — wired by
`tools_condition` so the graph runs the model, optionally dispatches
tool calls, threads results back, and re-enters the model until the
LLM stops emitting tool_calls.

This replaces the hand-rolled tool loop in the TS SDK
(`packages/catalyst-llm-sdk/src/client/client.ts streamChat`). The
playground UI consumes the resulting event stream via
`/api/chat/stream` (server.py).
"""
from __future__ import annotations

from typing import Optional

from langchain_core.messages import SystemMessage
from langchain_core.runnables import Runnable
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from .client import CatalystLiteLLMClient
from .config import LiteLLMConfig
from .tools import get_tools


def build_graph(
    *,
    model: str,
    tool_names: Optional[list[str]] = None,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    config: Optional[LiteLLMConfig] = None,
    extra_model_kwargs: Optional[dict] = None,
) -> Runnable:
    """Compile a LangGraph agent with the given model + tools.

    The returned Runnable accepts `{"messages": [...]}` and yields
    state updates via `.stream()` / `.astream_events(version="v2")`.

    Args:
        model: Model id known to the LiteLLM proxy (e.g. "mac/qwen3-coder").
        tool_names: Names of tools (web_search, …) the agent may call.
            Pass None for no tools (graph degenerates to a single LLM call).
        system_prompt: Optional system message prepended to every run.
        temperature: Sampling temperature.
        max_tokens: Optional response cap.
        config: LiteLLMConfig override; defaults to env-driven config.
        extra_model_kwargs: Extra kwargs forwarded to ChatOpenAI
            (reasoning_effort, top_p, presence_penalty, …).
    """
    client = CatalystLiteLLMClient(config=config)
    llm = client.get_chat_model(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        **(extra_model_kwargs or {}),
    )

    tools = get_tools(tool_names) if tool_names else []
    if tools:
        llm = llm.bind_tools(tools)

    def agent_node(state: MessagesState) -> dict:
        """Single LLM call. System prompt (if any) is injected on each
        entry — cheap and idempotent vs. mutating state in-place."""
        messages = list(state["messages"])
        if system_prompt and not (messages and isinstance(messages[0], SystemMessage)):
            messages = [SystemMessage(content=system_prompt), *messages]
        response = llm.invoke(messages)
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_edge(START, "agent")

    if tools:
        graph.add_node("tools", ToolNode(tools))
        # tools_condition returns "tools" when the assistant message has
        # tool_calls, END otherwise. The tool node loops back to agent.
        graph.add_conditional_edges("agent", tools_condition)
        graph.add_edge("tools", "agent")

    return graph.compile()
