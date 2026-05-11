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
"""
from __future__ import annotations

import os
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from ..client import CatalystLiteLLMClient
from .host import web_search

# Cheap + fast model by default — researcher mostly needs to call a
# tool and summarise. Operators can override via env if they want a
# heavier model for long-form syntheses.
DEFAULT_RESEARCH_MODEL = "claude-haiku-4-5-20251001"

# Hard cap on the sub-agent's tool-call loop. LangGraph's
# `recursion_limit` counts ALL graph steps (agent + tools), so each
# round-trip is two steps. 20 leaves room for ~10 search/read cycles
# before we bail — generous for shallow research, short enough that a
# stuck model can't burn a quota.
DEFAULT_MAX_RECURSION = 20

_RESEARCH_SYSTEM_PROMPT = (
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


def _build_research_graph(model: str):
    """Compile the research sub-agent graph.

    Identical in shape to the main agent graph (agent ↔ tools loop)
    but bound to a single tool — web_search — and a fixed researcher
    system prompt.
    """
    client = CatalystLiteLLMClient()
    # Low temperature: researcher should be deterministic about when
    # to stop. Synthesis quality > creativity here.
    llm = client.get_chat_model(model=model, temperature=0.3)
    llm = llm.bind_tools([web_search])

    def agent_node(state: MessagesState) -> dict:
        messages = list(state["messages"])
        if not (messages and isinstance(messages[0], SystemMessage)):
            messages = [
                SystemMessage(content=_RESEARCH_SYSTEM_PROMPT),
                *messages,
            ]
        return {"messages": [llm.invoke(messages)]}

    g = StateGraph(MessagesState)
    g.add_node("agent", agent_node)
    g.add_node("tools", ToolNode([web_search]))
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", tools_condition)
    g.add_edge("tools", "agent")
    return g.compile()


# Lazy build so unit tests can patch env vars / model selection
# before the first invocation, and so a stale import-time failure
# (e.g. LiteLLM unavailable on cold start) doesn't take down the
# whole tool registry.
_GRAPH = None
_GRAPH_MODEL: Optional[str] = None


def _get_graph(model: str):
    global _GRAPH, _GRAPH_MODEL
    if _GRAPH is None or _GRAPH_MODEL != model:
        _GRAPH = _build_research_graph(model)
        _GRAPH_MODEL = model
    return _GRAPH


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
    model = os.environ.get("CATALYST_RESEARCH_MODEL", DEFAULT_RESEARCH_MODEL)
    recursion_limit = int(
        os.environ.get("CATALYST_RESEARCH_MAX_RECURSION", DEFAULT_MAX_RECURSION)
    )

    instruction = query.strip()
    if depth == "deep":
        instruction += (
            "\n\nProvide a detailed answer drawing on multiple sources."
        )

    try:
        result = _get_graph(model).invoke(
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
