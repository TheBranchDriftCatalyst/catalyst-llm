"""Typed event schema for the /api/chat/stream SSE channel.

The UI consumes these as a discriminated union keyed on `type`. They're
a translation of LangGraph's `astream_events(version="v2")` firehose
into a small, stable shape the playground (and any future UI) can rely
on without coupling to LangGraph internals.

Add a new event type here when the UI needs to react to something new.
Resist the urge to forward LangGraph's raw events — the whole point of
this layer is that LangGraph internals can change without UI churn.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


class RunStarted(BaseModel):
    type: Literal["run_started"] = "run_started"
    run_id: str
    model: str


# Optional attribution shared by every "nestable" event below.
#
# When `owner_tool_id` is set, this event was produced INSIDE the
# execution of the named tool call (e.g. the council members'
# tokens while `research` runs). The UI uses this to route the
# event into that tool's expandable "reasoning" section in the
# ToolCallCard rather than dumping it into the parent's chat bubble.
# When None / omitted, the event came from the parent agent itself
# and renders inline as before. Field lives at the event level (not
# in a wrapper) so existing UIs keep working — they can just ignore
# the field and behave as today.
class _Nestable(BaseModel):
    owner_tool_id: Optional[str] = Field(
        default=None,
        description=(
            "Tool-call id this event was produced inside. None when "
            "produced by the parent agent. UIs use this to nest sub-"
            "agent activity (council members, critic, fusion) inside "
            "the parent tool card."
        ),
    )


class Token(_Nestable):
    """Single LLM content delta (from on_chat_model_stream)."""
    type: Literal["token"] = "token"
    content: str


class Reasoning(_Nestable):
    """Reasoning-trace delta (e.g. <think> blocks from r1-style models).
    Today we forward the raw text and let the UI's existing
    splitReasoning() / ReasoningBlock pipeline handle it."""
    type: Literal["reasoning"] = "reasoning"
    content: str


class ToolCallStart(_Nestable):
    type: Literal["tool_call_start"] = "tool_call_start"
    id: str
    name: str
    args: dict[str, Any]


class ToolCallEnd(_Nestable):
    type: Literal["tool_call_end"] = "tool_call_end"
    id: str
    result: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: int


class Iteration(_Nestable):
    """New tool-loop iteration begins. Mirrors the iteration counter the
    TS SDK exposed; UIs can use it for grouping or progress hints."""
    type: Literal["iteration"] = "iteration"
    n: int


class MessageDone(BaseModel):
    type: Literal["message_done"] = "message_done"
    finish_reason: Optional[str] = None
    usage: Optional[dict[str, Any]] = None


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


# Discriminated union — Pydantic uses the `type` field to pick the right
# model when parsing on the UI side (TS will mirror this with a
# string-tagged union). Keep this list ordered the same way the UI
# documents the events for readability.
AgentEvent = Union[
    RunStarted,
    Token,
    Reasoning,
    ToolCallStart,
    ToolCallEnd,
    Iteration,
    MessageDone,
    ErrorEvent,
]


class ChatStreamRequest(BaseModel):
    """Body of POST /api/chat/stream — a single chat dispatch.

    The minimum viable request is `{model, messages}`; everything else
    layers on top. For per-Agent config overrides (researcher model,
    recursion limits, system prompts, …), use `agent_config` —
    those values are validated against the matching Agent's Pydantic
    config_model before they reach the graph.
    """

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "model": "claude-haiku-4-5-20251001",
                    "messages": [{"role": "user", "content": "Say hi."}],
                },
                {
                    "model": "claude-haiku-4-5-20251001",
                    "messages": [
                        {"role": "user", "content": "Research the LiteLLM release notes."}
                    ],
                    "tools": ["research"],
                    "agent_config": {
                        "main": {"recursion_limit": 10},
                        "research": {
                            "model": "claude-haiku-4-5-20251001",
                            "recursion_limit": 8,
                        },
                    },
                },
            ]
        }
    }

    model: str = Field(
        description="Model id known to the LiteLLM proxy (see GET /api/models).",
        examples=["claude-haiku-4-5-20251001", "mac/qwen3-coder"],
    )
    messages: list[dict[str, Any]] = Field(
        description="OpenAI-style message dicts: `{role, content, ...}`.",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        description="Prepended to every chat-model invocation in the agent loop.",
    )
    tools: Optional[list[str]] = Field(
        default=None,
        description=(
            "Tool names from GET /api/tools. `null` or `[]` disables tools "
            "(graph degenerates to a single LLM call)."
        ),
        examples=[["web_search", "research"]],
    )
    params: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "Legacy main-Agent sampling params (temperature, max_tokens, "
            "top_p, reasoning_effort, …). Prefer `agent_config[\"main\"]` "
            "for new code; this stays supported for backward compat."
        ),
    )
    agent_config: Optional[dict[str, dict[str, Any]]] = Field(
        default=None,
        description=(
            "Per-Agent overrides for tunables advertised on `GET /api/agents`. "
            "Each inner dict is validated through that Agent's Pydantic "
            "config_model; bogus fields raise. Backward compat: when "
            "absent, request behaves identically to today's behaviour."
        ),
        examples=[
            {
                "main": {"recursion_limit": 10, "temperature": 0.4},
                "research": {"model": "claude-haiku-4-5-20251001"},
            }
        ],
    )
