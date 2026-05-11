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


class Token(BaseModel):
    """Single LLM content delta (from on_chat_model_stream)."""
    type: Literal["token"] = "token"
    content: str


class Reasoning(BaseModel):
    """Reasoning-trace delta (e.g. <think> blocks from r1-style models).
    Today we forward the raw text and let the UI's existing
    splitReasoning() / ReasoningBlock pipeline handle it."""
    type: Literal["reasoning"] = "reasoning"
    content: str


class ToolCallStart(BaseModel):
    type: Literal["tool_call_start"] = "tool_call_start"
    id: str
    name: str
    args: dict[str, Any]


class ToolCallEnd(BaseModel):
    type: Literal["tool_call_end"] = "tool_call_end"
    id: str
    result: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: int


class Iteration(BaseModel):
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
    """Body of POST /api/chat/stream."""
    model: str
    messages: list[dict[str, Any]] = Field(
        ..., description="OpenAI-style message dicts: {role, content, ...}."
    )
    system_prompt: Optional[str] = None
    tools: Optional[list[str]] = Field(
        default=None,
        description="Tool names from /api/tools. None or [] disables tools.",
    )
    params: Optional[dict[str, Any]] = Field(
        default=None,
        description="Sampling params: temperature, max_tokens, top_p, reasoning_effort, …",
    )
