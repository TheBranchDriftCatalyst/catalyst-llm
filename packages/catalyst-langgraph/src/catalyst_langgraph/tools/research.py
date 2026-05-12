"""`research` sub-agent — cognitive council with adaptive critic + fusion.

A LangChain tool that wraps a small but rich LangGraph sub-agent.
Conceptually:

    parent agent → research(query)
                    │
                    ▼  spawn N council members in parallel
        ┌─ member_1 ─ web_search loop ─┐
        ├─ member_2 ─ web_search loop ─┤
        └─ member_N ─ web_search loop ─┘
                    │
                    ▼
                  critic
                    ├─ "needs revision" → feed feedback back to members (next round)
                    └─ "approved" or max-rounds → fusion → return

Three personalities at work:

  - **Member** — a researcher running web_search internally. N copies
    run in parallel (asyncio.gather) so we get diverse-by-sampling
    drafts even at identical model + prompt.
  - **Critic** — reviews the council's drafts and either approves
    them or hands back structured feedback for the next round. The
    critic is what makes the loop *adaptive*: it can decide we've
    searched enough or push for another pass with more focus.
  - **Fusion** — synthesises the approved drafts into a single cited
    answer. Skipped when council_size == 1 (no fusion needed).

Base cases:
  - council_size=1, critic_enabled=False → single researcher, no
    fusion. Identical wire behaviour to the pre-council implementation,
    one ainvoke. The "1 is base case" the user asked for.
  - council_size=1, critic_enabled=True → single researcher in a
    critic-feedback loop. No fusion (nothing to fuse).
  - council_size>1, critic_enabled=False → N parallel drafts → fusion.
    Fastest broad-coverage path.
  - council_size>1, critic_enabled=True → N parallel drafts → critic →
    revise loop → fusion. The full ensemble.

Per-request overrides flow in via the `research_overrides` ContextVar
that server.py sets from agent_config["research"]; the @tool function
reads them when it dispatches.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextvars import ContextVar
from typing import Any, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
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

log = logging.getLogger(__name__)


# ───────────────────────────────────────────────────────────────────────
# Defaults & system prompts
# ───────────────────────────────────────────────────────────────────────

# Cheap + fast model for everything by default — researcher mostly
# needs to call a tool and summarise, and the critic + fusion are both
# small. Operators can override per-role via the Engine tab.
DEFAULT_RESEARCH_MODEL = "claude-haiku-4-5-20251001"

DEFAULT_MAX_RECURSION = 20
DEFAULT_TEMPERATURE = 0.3

DEFAULT_RESEARCH_SYSTEM_PROMPT = (
    "You are one of several research assistants on a council. You will "
    "see your member number in the brief. Your job is to gather a "
    "small number of useful sources via web_search and then synthesise "
    "a short, well-cited draft using the Feynman technique: write the "
    "draft as if explaining the answer to a smart non-expert who knows "
    "the surrounding domain but not this specific topic. The Feynman "
    "frame is the quality bar — if you can't explain a claim simply, "
    "you don't really know it, and that gap belongs in the draft.\n\n"
    "Feynman steps to apply while drafting:\n"
    "  1. Lead with the plain-language answer the user actually asked "
    "for, in 1-2 sentences. No throat-clearing.\n"
    "  2. Explain WHY / HOW in simple terms. When you must use a "
    "technical term, define it inline the first time.\n"
    "  3. Mark what's still uncertain or under-sourced as a `Gaps:` "
    "list at the end of the draft — that's a feature, not a failure. "
    "The fusion step needs to know what wasn't covered.\n"
    "  4. Reread your draft from the reader's perspective and cut "
    "anything that's restatement, hedging, or jargon-for-jargon's-sake.\n\n"
    "HARD RULES (do not violate these):\n"
    "- Make AT MOST 2 web_search calls. After your second result set, "
    "you MUST stop calling tools and write the answer with whatever you "
    "have — even if coverage feels incomplete. Flag the missing pieces "
    "in the `Gaps:` list rather than searching again.\n"
    "- If your first search returns relevant-looking results, write the "
    "answer immediately. Do not 'double-check' with a second search "
    "unless the first one was genuinely empty / off-topic.\n"
    "- Never re-issue the same query with cosmetic edits. If a second "
    "search is needed, pick a distinctly different angle.\n\n"
    "Style:\n"
    "- Pass time_range=\"month\" or \"year\" to web_search when the topic "
    "is time-sensitive (current versions, recent events, prices).\n"
    "- Cite each claim with the source URL inline, e.g. "
    "`(source: https://...)`.\n"
    "- Keep your draft under 6 short paragraphs unless the user explicitly "
    "asked for depth.\n"
    "- If you see reviewer feedback from a previous round, address it "
    "directly in this round's draft."
)

DEFAULT_CRITIC_SYSTEM_PROMPT = (
    "You are the editorial critic for a research council. You will be "
    "shown the user's original question and the drafts from N council "
    "members. Apply the Feynman test: would a smart non-expert "
    "actually learn the answer from these drafts, or are the members "
    "hiding behind jargon, hand-waving, or unsupported assertions?\n\n"
    "Reply STRICTLY as JSON with two keys:\n"
    '  {"approved": true|false, "feedback": "..."}\n\n'
    "Set `approved` to true when:\n"
    "- The drafts collectively answer the user's question in plain "
    "language a smart non-expert could follow.\n"
    "- Technical terms are defined inline the first time they appear.\n"
    "- Sources are cited inline and look credible.\n"
    "- Gaps (when listed) are honest and bounded — they don't gut the "
    "central claim.\n"
    "- Disagreements between members are minor or already noted.\n\n"
    "Set `approved` to false and provide concrete feedback when:\n"
    "- The drafts use jargon as a substitute for understanding "
    "(buzzword chains, hand-waving, 'it's complicated' dodges).\n"
    "- A core claim is asserted without a citation that would "
    "convince a skeptic.\n"
    "- The Gaps list contains something so central that the answer "
    "is misleading without it.\n"
    "- Members are confidently wrong or contradict authoritative info.\n"
    "- The drafts dodge or only partly answer the question.\n\n"
    "Keep `feedback` under 3 sentences and specific — name the exact "
    "phrasing or claim to fix. The council will re-search with your "
    "feedback as guidance."
)

DEFAULT_SHALLOW_SYSTEM_PROMPT = (
    "You are a research assistant. Answer the user's question by "
    "calling web_search once or twice, then synthesising a short, "
    "well-cited reply using the Feynman technique: lead with the plain "
    "answer, define jargon inline, mark uncertainty honestly.\n\n"
    "Feynman steps:\n"
    "  1. Lead with the plain-language answer in 1-2 sentences.\n"
    "  2. Explain WHY / HOW simply. Define technical terms inline.\n"
    "  3. End with a `Gaps:` list of what's still uncertain or "
    "under-sourced.\n"
    "  4. Reread + cut restatement / hedging / jargon-for-jargon's-sake.\n\n"
    "HARD RULES:\n"
    "- Make AT MOST 2 web_search calls. After your second search you "
    "MUST stop calling tools and write the answer.\n"
    "- If your first search returns useful results, write immediately. "
    "Do not 'double-check' with a second search unless the first was "
    "empty / off-topic.\n"
    "- Pass time_range=\"month\" or \"year\" to web_search when the topic "
    "is time-sensitive.\n"
    "- Cite each claim inline as `(source: https://...)`.\n"
    "- Keep the reply under 4 short paragraphs."
)

DEFAULT_FUSION_SYSTEM_PROMPT = (
    "You are the research fusion agent. You will see the user's "
    "original question and the approved drafts from N council members. "
    "Your job is to produce a single consolidated markdown answer "
    "written in the Feynman style: lead with the plain answer, "
    "explain WHY simply, define jargon inline, mark uncertainty "
    "honestly. Imagine the reader is a curious, smart non-expert.\n\n"
    "How to fuse:\n"
    "- Open with a 1-2 sentence direct answer to the user's question. "
    "No throat-clearing, no 'great question'.\n"
    "- Then expand: WHY does it work / matter, in simple terms. When "
    "you introduce a technical term, give a one-line definition.\n"
    "- Identify the strongest, most-cited claims that multiple members "
    "agree on; promote those.\n"
    "- Surface useful disagreements: when members reach different "
    "conclusions, flag the disagreement explicitly rather than silently "
    "picking one — say WHY they disagree (different sources, time "
    "windows, definitions).\n"
    "- Merge each member's `Gaps:` list into a single short Gaps "
    "section at the end — these are the bits the council couldn't "
    "verify, so the user knows the limits of the answer.\n"
    "- Discard restatement, boilerplate, hedging, and jargon used as "
    "a substitute for explanation.\n"
    "- Preserve source URLs inline next to every load-bearing claim."
)


# ───────────────────────────────────────────────────────────────────────
# Pydantic config — schema + validation + defaults for /api/agents.
# ───────────────────────────────────────────────────────────────────────


class Critique(BaseModel):
    """Structured critic output, produced by the JSON-mode critic call."""

    approved: bool = Field(
        description="True if the council answers are good enough to fuse."
    )
    feedback: str = Field(
        default="",
        description="Specific guidance for the next round (ignored when approved).",
    )


class ResearchAgentConfig(BaseModel):
    """Tunables for the research council.

    Existing member-level field names (`model`, `temperature`,
    `recursion_limit`, `system_prompt`) are preserved so engineStore
    entries from the pre-council schema keep working. Extra fields are
    ignored on load (not forbidden) — that keeps stale keys from a
    schema-drift roll-back from rejecting the whole config.
    """

    model_config = {"extra": "ignore", "json_schema_extra": {"agent_id": "research"}}

    # Council ensemble. N=1 is the base case — single researcher, no
    # fusion. Cap at 8 because cloud rate limits + we rarely need more
    # diverse drafts than that for research questions.
    council_size: int = Field(
        default=1,
        ge=1,
        le=8,
        title="Council size",
        description=(
            "Number of parallel research members. 1 = single researcher "
            "(base case, no fusion). N > 1 fans out and uses the fusion "
            "agent to consolidate."
        ),
        json_schema_extra={"ui": {"step": 1}},
    )

    # Member fields (per-researcher).
    model: str = Field(
        default=DEFAULT_RESEARCH_MODEL,
        title="Member model",
        description="LLM each council member uses. Cheap+fast is usually right.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    temperature: float = Field(
        default=DEFAULT_TEMPERATURE,
        ge=0,
        le=2,
        title="Member temperature",
        description="Council members run with this temperature — slight diversity helps.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    recursion_limit: int = Field(
        default=DEFAULT_MAX_RECURSION,
        ge=2,
        le=100,
        title="Member recursion limit",
        description="Hard cap on each member's internal graph steps (≈2 per search round-trip).",
        json_schema_extra={"ui": {"step": 1}},
    )
    system_prompt: str = Field(
        default=DEFAULT_RESEARCH_SYSTEM_PROMPT,
        title="Member system prompt",
        description="Instructions every council member follows.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )

    # Critic loop. Disabled by default — opt-in for adaptive refinement.
    critic_enabled: bool = Field(
        default=False,
        title="Critic enabled",
        description=(
            "When on, an editorial critic reviews the council's drafts and "
            "can request another round with concrete feedback. Adds rounds "
            "until approved or max_critique_rounds."
        ),
    )
    critic_model: str = Field(
        default="",
        title="Critic model",
        description="LLM the critic uses. Empty = falls back to the member model.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    critic_temperature: float = Field(
        default=0.2,
        ge=0,
        le=2,
        title="Critic temperature",
        description="Lower = more deterministic approval decisions.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    critic_system_prompt: str = Field(
        default=DEFAULT_CRITIC_SYSTEM_PROMPT,
        title="Critic system prompt",
        description="What the critic looks for. Adjust to weight different quality signals.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )
    max_critique_rounds: int = Field(
        default=2,
        ge=1,
        le=5,
        title="Max critique rounds",
        description="Hard cap on critic iterations. After this many rounds we fuse whatever we have.",
        json_schema_extra={"ui": {"step": 1}},
    )

    # Fusion (only used when council_size > 1).
    fusion_model: str = Field(
        default="",
        title="Fusion model",
        description="LLM the fusion agent uses. Empty = falls back to the member model.",
        json_schema_extra={"ui": {"widget": "model"}},
    )
    fusion_temperature: float = Field(
        default=0.2,
        ge=0,
        le=2,
        title="Fusion temperature",
        description="Lower = more conservative synthesis.",
        json_schema_extra={"ui": {"step": 0.05}},
    )
    fusion_system_prompt: str = Field(
        default=DEFAULT_FUSION_SYSTEM_PROMPT,
        title="Fusion system prompt",
        description="Instructions the fusion agent follows when consolidating drafts.",
        json_schema_extra={"ui": {"widget": "textarea"}},
    )


# ───────────────────────────────────────────────────────────────────────
# ContextVar override channels.
#
# `research_overrides` — per-request tunables (model, temperature, …)
#     set from agent_config["research"]. Read by `_load_config()`.
#
# `caller_context` — conversational context from the parent agent that
#     called us. The parent sees `research` as a single tool call and
#     usually only passes the immediate `query`. Without broader
#     context, the council can drift toward generic results ("research
#     latest WWDC" with no prior context might miss that the chat was
#     about Swift). The server populates this with the parent's last
#     few user messages on each chat dispatch; the tool prepends it
#     to every member brief so each council member knows the chat's
#     trajectory. The @tool function also accepts an explicit
#     `context` arg which takes precedence when the parent model chose
#     to be deliberate about it.
# Both ContextVars are reset by server.py in its `finally` block so
# state can't leak between requests on the same worker.
# ───────────────────────────────────────────────────────────────────────

research_overrides: ContextVar[dict[str, Any]] = ContextVar(
    "research_overrides", default={}
)

caller_context: ContextVar[str] = ContextVar(
    "caller_context", default=""
)


def _load_config() -> ResearchAgentConfig:
    """Merge overrides + defaults into a fully-validated config."""
    overrides = dict(research_overrides.get() or {})
    # Env-var fallbacks for the two oldest knobs (kept for ops parity).
    if "model" not in overrides:
        env_model = os.environ.get("CATALYST_RESEARCH_MODEL")
        if env_model:
            overrides["model"] = env_model
    if "recursion_limit" not in overrides:
        env_limit = os.environ.get("CATALYST_RESEARCH_MAX_RECURSION")
        if env_limit:
            try:
                overrides["recursion_limit"] = int(env_limit)
            except ValueError:
                pass
    return ResearchAgentConfig.model_validate(overrides)


# ───────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────


def _flatten_content(content: Any) -> str:
    """LangChain messages sometimes carry list-of-parts content (Anthropic).
    Flatten to a plain string so the consumer (parent agent or fusion)
    sees a single text blob."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
        )
    return str(content)


def _underlying_is_ollama(client: CatalystLiteLLMClient, model: str) -> bool:
    """True when LiteLLM routes this model id to an Ollama backend.

    LiteLLM's Ollama OpenAI-compat streaming path doesn't translate
    tool_calls into structured deltas — the JSON arrives as
    `delta.content` text instead, so any LLM with tools bound and
    streaming on emits its tool calls as plain content and the
    bound web_search never actually fires. Disabling streaming
    works around it. Mirror the same gate the main `build_graph()`
    uses; we lose token-level streaming for sub-agents but they
    weren't user-visible streams anyway.
    """
    try:
        info = client.get_model_info(model) or {}
        underlying = ((info.get("litellm_params") or {}).get("model") or "").lower()
        return underlying.startswith("ollama/")
    except Exception:
        return False


def _build_member_graph(model: str, temperature: float, system_prompt: str):
    """Compile the per-member researcher graph: agent ↔ web_search loop.

    Built per-dispatch (one compile per chat request) so per-request
    config overrides take effect without graph caching staleness.
    Compilation is cheap; the round-trip to LiteLLM dominates.
    """
    client = CatalystLiteLLMClient()
    llm = client.get_chat_model(
        model=model,
        temperature=temperature,
        # Force non-streaming when this member is Ollama-routed so the
        # LLM's tool_calls field is populated structurally; the bound
        # web_search then actually dispatches instead of arriving as
        # text in content (see _underlying_is_ollama for the why).
        streaming=not _underlying_is_ollama(client, model),
    )
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


async def _run_member(
    member_id: int,
    brief: str,
    cfg: ResearchAgentConfig,
) -> str:
    """Dispatch one council member. Each member sees its 1-based id in
    the brief so the model can stamp the draft (useful for the critic
    to reference "member #2 said X")."""
    annotated = f"You are council member #{member_id + 1}.\n\n{brief}"
    compiled = _build_member_graph(cfg.model, cfg.temperature, cfg.system_prompt)
    try:
        result = await compiled.ainvoke(
            {"messages": [HumanMessage(content=annotated)]},
            config={"recursion_limit": cfg.recursion_limit},
        )
    except Exception as exc:
        log.warning("research member #%d failed: %s", member_id + 1, exc)
        return f"[member #{member_id + 1} failed: {exc}]"
    msgs = result.get("messages") or []
    if not msgs:
        return f"[member #{member_id + 1} returned no messages]"
    return _flatten_content(getattr(msgs[-1], "content", ""))


async def _run_critic(
    query: str,
    drafts: list[str],
    cfg: ResearchAgentConfig,
) -> Critique:
    """One critic pass over the council's current drafts. Returns a
    structured Critique. Falls back to "approved + no feedback" on any
    failure rather than blocking the run forever."""
    model = cfg.critic_model or cfg.model
    client = CatalystLiteLLMClient()
    llm = client.get_chat_model(
        model=model,
        temperature=cfg.critic_temperature,
        # `with_structured_output` is doubly Ollama-fragile under
        # streaming (it uses tool-calling under the hood). Force
        # non-streaming when routed there.
        streaming=not _underlying_is_ollama(client, model),
    )
    # Structured-output binding — LangChain coerces the JSON into a
    # Critique instance for us.
    structured = llm.with_structured_output(Critique)

    drafts_block = "\n\n".join(
        f"### Member #{i + 1} draft\n{d}" for i, d in enumerate(drafts)
    )
    body = (
        f"User question:\n{query}\n\n"
        f"Council drafts:\n{drafts_block}\n\n"
        "Reply with the JSON object as specified."
    )
    try:
        critique = await structured.ainvoke(
            [
                SystemMessage(content=cfg.critic_system_prompt),
                HumanMessage(content=body),
            ]
        )
        # `with_structured_output` should return a Critique instance,
        # but some providers return a dict — coerce defensively.
        if isinstance(critique, Critique):
            return critique
        if isinstance(critique, dict):
            return Critique.model_validate(critique)
        log.warning("critic returned unexpected shape: %r", type(critique))
        return Critique(approved=True, feedback="")
    except Exception as exc:
        log.warning("critic failed (%s) — auto-approving to unblock", exc)
        return Critique(approved=True, feedback="")


async def _run_fusion(
    query: str,
    drafts: list[str],
    cfg: ResearchAgentConfig,
) -> str:
    """Single LLM call that synthesises the council's approved drafts
    into one final markdown answer."""
    model = cfg.fusion_model or cfg.model
    client = CatalystLiteLLMClient()
    llm = client.get_chat_model(
        model=model,
        temperature=cfg.fusion_temperature,
        # No tools bound, but force non-streaming when routed to
        # Ollama anyway — keeps fusion's output a single chat-model-
        # end event at the parent's astream_events, which makes the
        # per-tool reasoning UI cleaner.
        streaming=not _underlying_is_ollama(client, model),
    )
    drafts_block = "\n\n".join(
        f"### Member #{i + 1} draft\n{d}" for i, d in enumerate(drafts)
    )
    body = (
        f"User question:\n{query}\n\n"
        f"Approved council drafts:\n{drafts_block}\n\n"
        "Produce the consolidated answer."
    )
    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=cfg.fusion_system_prompt),
                HumanMessage(content=body),
            ]
        )
        return _flatten_content(getattr(response, "content", ""))
    except Exception as exc:
        log.warning("fusion failed (%s) — returning the longest draft as fallback", exc)
        return max(drafts, key=len) if drafts else f"fusion failed: {exc}"


async def _run_shallow_bypass(brief: str, cfg: ResearchAgentConfig) -> str:
    """Single-agent bypass for `depth="shallow"`.

    Per the multi-agent literature (arXiv 2604.02460 et al.), a single
    strong model with a clean tool-calling loop often beats an N-member
    council under equal compute on simple factual questions — the
    council's diversity bonus is wasted when there isn't actually
    contested ground to surface. So shallow queries skip the fan-out
    entirely: one researcher, web_search bound, same Feynman writing
    style, no fusion. Fast + cheap + usually-right.

    The council path stays available via `depth="deep"` for questions
    where multiple angles or adversarial review pay off.

    Uses `cfg.model` — operators who want shallow to use a stronger
    model than the council members can either override
    `agent_config["research"]["model"]` per request, or just always
    pick a stronger member model in the Engine tab (the council
    benefits too).
    """
    compiled = _build_member_graph(
        cfg.model, cfg.temperature, DEFAULT_SHALLOW_SYSTEM_PROMPT
    )
    try:
        result = await compiled.ainvoke(
            {"messages": [HumanMessage(content=brief)]},
            config={"recursion_limit": cfg.recursion_limit},
        )
    except Exception as exc:
        log.warning("research shallow bypass failed: %s", exc)
        return f"research failed: {exc}"
    msgs = result.get("messages") or []
    if not msgs:
        return "[research produced no draft]"
    return _flatten_content(getattr(msgs[-1], "content", ""))


# ───────────────────────────────────────────────────────────────────────
# The tool itself.
# ───────────────────────────────────────────────────────────────────────


@tool
async def research(
    query: str,
    depth: str = "shallow",
    context: str = "",
) -> str:
    """Run a web research pass and return a synthesised answer.

    Two depth modes:

      - `"shallow"` (default) → ONE researcher, one tool-loop, no
        fusion. Fast + cheap. The single-agent path is the right
        choice for most factual questions; multi-agent councils only
        pay off when there's genuinely contested ground (see "deep").
      - `"deep"` → full council of N parallel research members,
        optional editorial critic that can request another round, and
        a fusion agent that consolidates the approved drafts into one
        cited answer. Use when the question is contested, has multiple
        valid angles, or you want adversarial review to catch
        single-model overconfidence.

    Args:
        query: The research question, phrased naturally.
        depth: "shallow" (default — single-agent bypass) or "deep"
            (full council + critic + fusion).
        context: Optional background from this conversation that should
            inform the search. Use this when the user's question only
            makes sense given prior context — e.g. "they're asking about
            recent WWDC; the chat is about Swift performance." When
            omitted, the researcher automatically inherits the last few
            messages from the parent chat as implicit context.

    Returns:
        Markdown-formatted answer with inline source citations.
    """
    cfg = _load_config()

    # Caller context: prefer the explicit `context` arg (parent model
    # chose to be deliberate); fall back to the ContextVar the server
    # populates from the parent chat's recent history. Members see
    # whichever is present — they don't need to know which channel
    # delivered it.
    implicit_context = caller_context.get() or ""
    effective_context = (context or "").strip() or implicit_context

    brief = query.strip()
    if effective_context:
        brief = (
            f"## Context from the parent conversation\n{effective_context}\n\n"
            f"## Research question\n{brief}"
        )

    # Shallow → single-agent bypass. Skip the council fan-out entirely.
    # This is the right default for most factual queries; the council
    # is only worth its cost when "deep" is explicitly requested.
    if depth != "deep":
        return await _run_shallow_bypass(brief, cfg)

    # Deep → full council + critic + fusion path below.
    brief += "\n\nProvide a detailed answer drawing on multiple sources."

    feedback = ""
    drafts: list[str] = []
    critique: Optional[Critique] = None

    rounds = cfg.max_critique_rounds if cfg.critic_enabled else 1
    for round_n in range(rounds):
        round_brief = brief
        if feedback:
            round_brief = (
                f"{brief}\n\n"
                f"## Reviewer feedback from previous round (address this):\n{feedback}"
            )

        # Fan-out: N members in parallel.
        tasks = [_run_member(i, round_brief, cfg) for i in range(cfg.council_size)]
        drafts = await asyncio.gather(*tasks)

        if not cfg.critic_enabled:
            break

        critique = await _run_critic(brief, drafts, cfg)
        if critique.approved:
            break
        feedback = critique.feedback or ""
        # If the critic refuses to provide feedback, no point looping.
        if not feedback:
            break

    # N = 1 base case: nothing to fuse — return the lone draft.
    if cfg.council_size == 1:
        return drafts[0] if drafts else "[research produced no draft]"

    # N > 1: fusion pass.
    return await _run_fusion(brief, drafts, cfg)


# ───────────────────────────────────────────────────────────────────────
# Agent registry entry — surfaced on the Engine tab.
# ───────────────────────────────────────────────────────────────────────

register_agent(
    AgentDescriptor(
        id="research",
        description=(
            "Web-research council: N parallel members loop over web_search; "
            "an optional adaptive critic drives revision rounds; a fusion agent "
            "consolidates the approved drafts into one cited markdown answer. "
            "Set council_size=1 + critic_enabled=False for the simplest base case."
        ),
        config_model=ResearchAgentConfig,
        topology=AgentTopology(
            nodes=[
                AgentTopologyNode(id="__start__", type="start"),
                AgentTopologyNode(id="members", type="agent"),
                AgentTopologyNode(id="web_search", type="tools"),
                AgentTopologyNode(id="critic", type="agent"),
                AgentTopologyNode(id="fusion", type="agent"),
                AgentTopologyNode(id="__end__", type="end"),
            ],
            edges=[
                AgentTopologyEdge(source="__start__", target="members"),
                # Each member's inner tool loop.
                AgentTopologyEdge(
                    source="members", target="web_search", conditional=True
                ),
                AgentTopologyEdge(source="web_search", target="members"),
                # Members → critic when drafts are ready.
                AgentTopologyEdge(source="members", target="critic"),
                # Critic feedback loop (conditional) ← adaptive part.
                AgentTopologyEdge(source="critic", target="members", conditional=True),
                # Approved → fusion → end.
                AgentTopologyEdge(source="critic", target="fusion", conditional=True),
                AgentTopologyEdge(source="fusion", target="__end__"),
            ],
        ),
        tools=["web_search"],
    )
)
