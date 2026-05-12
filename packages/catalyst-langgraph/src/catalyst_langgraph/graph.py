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

from pydantic import BaseModel, Field

from .agents import (
    AgentDescriptor,
    AgentTopology,
    AgentTopologyEdge,
    AgentTopologyNode,
    register_agent,
)
from .client import CatalystLiteLLMClient
from .config import LiteLLMConfig
from .tools import get_tools

# Default recursion budget for the main agent's tools loop. LangGraph's
# baseline is 25; we surface it as a tunable so operators can cap stuck
# Ollama-served models without an env-var redeploy. Each tools-loop
# round-trip burns ~2 steps, so 25 ≈ 12 tool calls before bailout.
DEFAULT_MAIN_RECURSION_LIMIT = 25


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
    tools = get_tools(tool_names) if tool_names else []

    client = CatalystLiteLLMClient(config=config)
    # NOTE on `streaming` flag:
    # LiteLLM's Ollama OpenAI-compat path doesn't parse tool calls out
    # of the streaming response — when stream=true the JSON arrives as
    # `delta.content` tokens instead of `delta.tool_calls` and
    # ChatOpenAI gives us back an AIMessage with no structured
    # tool_calls. Non-streaming works correctly. langchain-ollama
    # itself makes the same trade-off (issue #26971): no token-level
    # streaming when tools are bound.
    #
    # We gate ONLY on Ollama-routed models — cloud providers (Anthropic,
    # OpenAI, Google direct) emit proper tool_calls deltas during
    # streaming, so those keep their live-token UX even with tools. We
    # consult LiteLLM /model/info for the underlying provider rather
    # than pattern-matching the friendly name; that way the gate
    # doesn't drift when models get renamed.
    streaming_ok = True
    if tools:
        info = client.get_model_info(model) or {}
        underlying = (
            (info.get("litellm_params") or {}).get("model") or ""
        ).lower()
        if underlying.startswith("ollama/"):
            streaming_ok = False
    llm = client.get_chat_model(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming_ok,
        **(extra_model_kwargs or {}),
    )

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


# ───────────────────────────────────────────────────────────────────────
# Agent registry entry — surfaced on the Engine tab.
#
# Per-node Pydantic configs own their own schema, validation, and
# defaults. /api/agents emits each node's `config_schema` (from
# `node.config_model.model_json_schema()`) + `config_defaults` so the
# right-panel form can render per node. /api/chat/stream's incoming
# `agent_config[agent_id][node_id]` is validated against the matching
# node's model before reaching build_graph.
#
# UI affordances ride in `json_schema_extra={"ui": {...}}`. The
# `widget` hint picks a non-default renderer (e.g. ModelSelector for
# string fields that should be a model dropdown, or a textarea for
# multiline strings). Standard JSON Schema keys (`minimum`, `maximum`,
# `default`, `description`, `title`) drive the rest.
#
# Topology is hand-described — graph shape is fixed (agent ↔ tools
# loop) and a static descriptor avoids an HTTP roundtrip to LiteLLM
# on every /api/agents call. Update this block if the graph shape
# ever changes.
# ───────────────────────────────────────────────────────────────────────


class MainAgentNodeConfig(BaseModel):
    """Tunables for the `agent` node of the main chat loop.

    Owns every operator-tweakable knob involved in the LLM call:
    model id, sampling params, response cap, system prompt, and the
    loop's recursion budget. The `tools` node has no config (it's a
    pure dispatcher) and the `__start__`/`__end__` terminals don't
    take tunables.

    Every field is optional with a baked-in default so the Engine tab
    can send partial overrides — `{"recursion_limit": 5}` validates
    just fine and the rest of the fields fall back to their defaults.
    """

    model_config = {
        "extra": "forbid",
        "json_schema_extra": {"agent_id": "main", "node_id": "agent"},
    }

    model: str = Field(
        default="",
        title="Model",
        description="The chat model the operator picks per chat — this field reflects the live selection, not a global default.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    temperature: float = Field(
        default=0.7,
        ge=0,
        le=2,
        title="Temperature",
        description="Sampling temperature. 0 = deterministic, 2 = wild.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    max_tokens: int = Field(
        default=2048,
        ge=64,
        le=32768,
        title="Max tokens",
        description="Hard ceiling on the response length.",
        json_schema_extra={"ui": {"step": 64}},
    )
    top_p: float = Field(
        default=1.0,
        ge=0,
        le=1,
        title="Top P",
        description="Nucleus sampling. 1.0 = disabled (and stripped server-side to avoid provider rejections when combined with temperature).",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    recursion_limit: int = Field(
        default=DEFAULT_MAIN_RECURSION_LIMIT,
        ge=2,
        le=100,
        title="Recursion limit",
        description="Hard cap on graph steps. Each tool-loop round-trip ≈ 2 steps. Drop this when local models thrash.",
        json_schema_extra={"ui": {"step": 1}},
    )
    system_prompt: str = Field(
        default="You are a helpful assistant.",
        title="System prompt",
        description="Prepended to every chat request from this agent.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )


register_agent(
    AgentDescriptor(
        id="main",
        description="Top-level chat agent loop. Dispatches tools, threads results back, and continues until the model stops emitting tool_calls.",
        topology=AgentTopology(
            nodes=[
                AgentTopologyNode(id="__start__", type="start"),
                AgentTopologyNode(
                    id="agent", type="agent", config_model=MainAgentNodeConfig
                ),
                AgentTopologyNode(id="tools", type="tools"),
                AgentTopologyNode(id="__end__", type="end"),
            ],
            edges=[
                AgentTopologyEdge(source="__start__", target="agent"),
                AgentTopologyEdge(source="agent", target="tools", conditional=True),
                AgentTopologyEdge(source="agent", target="__end__", conditional=True),
                AgentTopologyEdge(source="tools", target="agent"),
            ],
        ),
    )
)
