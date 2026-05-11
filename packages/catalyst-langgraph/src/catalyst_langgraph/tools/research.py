"""`research` sub-agent tool.

A LangChain tool that wraps a small LangGraph sub-agent. The main
chat agent calls `research(query)` and gets back a synthesised answer;
the sub-agent runs its own web_search → read → summarise loop
internally. This lets the user write "research X" without manually
orchestrating multi-step search across the parent conversation.

Architecture:
    parent agent  ─call─►  research(query)
                            │
                            ▼  (internal sub-graph)
                          agent ─tool_call─► web_search
                            ▲                  │
                            └──── result ──────┘
                            │
                            ▼  (final synthesised text)
    parent agent  ◄─return─

The parent only sees `research` as a single tool call. The sub-agent's
internal iterations are hidden from the chat UI — they're an
implementation detail of the tool. If we want sub-agent transparency
later, the tool can stream events upward (Phase 2).

Per-request overrides (model, recursion limit, system prompt, …) flow
in via a ContextVar set by `server.py` from the incoming
`agent_config["research"]` payload. ContextVar is the right primitive
here — it survives `await` boundaries, doesn't couple us to any
LangGraph internals, and lets the @tool function read overrides
without changing its signature (which would break the parent's
tool-calling contract).
"""
from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from pydantic import BaseModel, Field

from ..agents import (
    AgentDescriptor,
    AgentTopology,
    AgentTopologyEdge,
    AgentTopologyNode,
    register_agent,
)
from ..client import CatalystLiteLLMClient
from .host import web_search

# Cheap + fast model by default — researcher mostly needs to call a
# tool and summarise. Operators can override via env, or per-request
# from the Engine tab via `agent_config["research"]["model"]`.
DEFAULT_RESEARCH_MODEL = "claude-haiku-4-5-20251001"

# Hard cap on the sub-agent's tool-call loop. LangGraph's
# `recursion_limit` counts ALL graph steps (agent + tools), so each
# round-trip is two steps. 20 leaves room for ~10 search/read cycles
# before we bail — generous for shallow research, short enough that a
# stuck model can't burn a quota.
DEFAULT_MAX_RECURSION = 20

DEFAULT_TEMPERATURE = 0.3

DEFAULT_RESEARCH_SYSTEM_PROMPT = (
    "You are a research assistant. Your job is to answer the user's "
    "question by calling web_search one or more times to gather sources, "
    "then synthesising a short, well-cited answer.\n\n"
    "Guidelines:\n"
    "- Use web_search at least once; reformulate the query if the first "
    "result set is unhelpful.\n"
    "- Prefer recent sources for time-sensitive topics; pass "
    'time_range="month" or "year" to web_search when appropriate.\n'
    "- Cite each claim with the source URL inline, e.g. `(source: https://...)`.\n"
    "- Keep the final answer under 6 short paragraphs unless the user "
    "asked for depth.\n"
    "- Once you have enough information, stop calling tools and write the "
    "answer. Do not loop indefinitely."
)


# Per-request overrides. `server.py:_stream_agent_events` sets this
# from `request.agent_config["research"]` before invoking the parent
# graph; the `@tool research` function reads it when dispatched.
# Keep the shape `dict[str, Any]` — it mirrors the AgentField names
# (`model`, `recursion_limit`, `temperature`, `system_prompt`).
research_overrides: ContextVar[dict[str, Any]] = ContextVar(
    "research_overrides", default={}
)


def _resolve(field_name: str, env_var: Optional[str], fallback: Any) -> Any:
    """Resolve a config value with precedence: ContextVar > env > default."""
    overrides = research_overrides.get()
    if field_name in overrides and overrides[field_name] is not None:
        return overrides[field_name]
    if env_var:
        env_value = os.environ.get(env_var)
        if env_value is not None:
            return env_value
    return fallback


def _build_research_graph(model: str, temperature: float, system_prompt: str):
    """Compile the research sub-agent graph.

    Identical in shape to the main agent graph (agent ↔ tools loop)
    but bound to a single tool — web_search — and a fixed researcher
    system prompt. Built fresh per dispatch so per-request overrides
    take effect without graph caching staleness; the cost is one
    ChatOpenAI construction per research call (cheap).
    """
    client = CatalystLiteLLMClient()
    llm = client.get_chat_model(model=model, temperature=temperature)
    llm = llm.bind_tools([web_search])

    def agent_node(state: MessagesState) -> dict:
        messages = list(state["messages"])
        if not (messages and isinstance(messages[0], SystemMessage)):
            messages = [SystemMessage(content=system_prompt), *messages]
        return {"messages": [llm.invoke(messages)]}

    g = StateGraph(MessagesState)
    g.add_node("agent", agent_node)
    g.add_node("tools", ToolNode([web_search]))
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", tools_condition)
    g.add_edge("tools", "agent")
    return g.compile()


@tool
def research(query: str, depth: str = "shallow") -> str:
    """Run a multi-step web research pass and return a synthesised answer.

    Use this for questions that need up-to-date information from the
    web (current events, recent releases, prices, etc.). The research
    sub-agent calls web_search internally as many times as it needs
    and returns a cited summary — you don't need to call web_search
    yourself once you've delegated to this tool.

    Args:
        query: The research question, phrased naturally.
        depth: "shallow" (default, ~3-5 paragraphs) or "deep"
            (more sources, longer answer).

    Returns:
        Markdown-formatted answer with inline source citations.
    """
    model = _resolve("model", "CATALYST_RESEARCH_MODEL", DEFAULT_RESEARCH_MODEL)
    temperature = float(
        _resolve("temperature", None, DEFAULT_TEMPERATURE)
    )
    system_prompt = _resolve(
        "system_prompt", None, DEFAULT_RESEARCH_SYSTEM_PROMPT
    )
    recursion_limit = int(
        _resolve(
            "recursion_limit",
            "CATALYST_RESEARCH_MAX_RECURSION",
            DEFAULT_MAX_RECURSION,
        )
    )

    instruction = query.strip()
    if depth == "deep":
        instruction += (
            "\n\nProvide a detailed answer drawing on multiple sources."
        )

    try:
        compiled = _build_research_graph(model, temperature, system_prompt)
        result = compiled.invoke(
            {"messages": [HumanMessage(content=instruction)]},
            config={"recursion_limit": recursion_limit},
        )
    except Exception as exc:
        # Surface failures back to the parent agent rather than
        # raising — the parent should be able to decide whether to
        # retry, reformulate, or tell the user.
        return f"research failed: {exc}"

    msgs = result.get("messages") or []
    if not msgs:
        return "research: no output produced."
    last = msgs[-1]
    content = getattr(last, "content", None)
    if not content:
        return "research: empty response."
    if isinstance(content, list):
        # Anthropic-style content parts; flatten to text.
        content = "".join(
            p.get("text", "") if isinstance(p, dict) else str(p)
            for p in content
        )
    return str(content)


# ───────────────────────────────────────────────────────────────────────
# Agent registry entry — surfaced on the Engine tab.
# ───────────────────────────────────────────────────────────────────────


class ResearchAgentConfig(BaseModel):
    """Tunables for the `research` sub-agent.

    Every field is optional with a baked-in default so the Engine tab
    can send partial overrides. The /api/chat/stream path validates
    `agent_config["research"]` through this class and stuffs the
    validated values into `research_overrides` (the ContextVar the
    @tool function reads at dispatch time).
    """

    model_config = {"extra": "forbid", "json_schema_extra": {"agent_id": "research"}}

    model: str = Field(
        default=DEFAULT_RESEARCH_MODEL,
        title="Researcher model",
        description="The LLM that runs inside the research loop. Defaults to a cheap, fast model since the researcher mostly needs to summarise.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    temperature: float = Field(
        default=DEFAULT_TEMPERATURE,
        ge=0,
        le=2,
        title="Temperature",
        description="Lower = more deterministic about when to stop searching. Synthesis quality > creativity here.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    recursion_limit: int = Field(
        default=DEFAULT_MAX_RECURSION,
        ge=2,
        le=100,
        title="Recursion limit",
        description="Hard cap on internal graph steps (≈2 per search round-trip). Drop this when local models thrash.",
        json_schema_extra={"ui": {"step": 1}},
    )
    system_prompt: str = Field(
        default=DEFAULT_RESEARCH_SYSTEM_PROMPT,
        title="Researcher system prompt",
        description="The instructions the researcher follows on every dispatch. Tweak to bias toward citations, depth, recency, etc.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )


register_agent(
    AgentDescriptor(
        id="research",
        description="Web-research sub-agent. Loops over web_search until it has enough sources, then synthesises a cited markdown answer.",
        config_model=ResearchAgentConfig,
        topology=AgentTopology(
            nodes=[
                AgentTopologyNode(id="__start__", type="start"),
                AgentTopologyNode(id="agent", type="agent"),
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
        tools=["web_search"],
    )
)
