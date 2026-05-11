"""Agent registry — central source of truth for what the Engine tab sees.

An "Agent" here is a compiled LangGraph state machine that owns an LLM
and a loop. Today: the main chat agent (`main`) and the research
sub-agent (`research`). Each module that defines an Agent calls
`register_agent(...)` at import time; the playground's Engine tab
fetches the merged registry via `GET /api/agents` and renders each
Agent's topology + config form.

Schema model: each Agent declares its own **Pydantic** config class.
That single class owns three responsibilities:
  1. *Schema* — `model_json_schema()` produces the JSON Schema the
     Engine tab renders as a form.
  2. *Validation* — the server runs incoming `agent_config[agent_id]`
     through `model.model_validate(partial)` so the tool dispatcher
     never has to defend against unknown fields or wrong types.
  3. *Defaults* — fields with `Field(default=...)` materialise as the
     "no override" baseline both in the form and in the request path.

UI affordances that JSON Schema doesn't natively carry (`widget="model"`
to hook into ModelSelector, `widget="textarea"` for multiline strings,
custom slider `step`, `secret` flags) ride along in
`Field(..., json_schema_extra={"ui": {...}})`. The frontend renderer
reads that `ui` extension key to pick a widget; standard JSON Schema
keys (`type`, `minimum`/`maximum`, `enum`, `description`, `default`)
drive the rest.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel


NodeType = Literal["start", "end", "agent", "tools"]


@dataclass
class AgentTopologyNode:
    """One node in an Agent's LangGraph topology."""

    id: str
    type: NodeType = "agent"


@dataclass
class AgentTopologyEdge:
    """One edge between two topology nodes."""

    source: str
    target: str
    conditional: bool = False


@dataclass
class AgentTopology:
    """Static topology snapshot for the Engine tab to render.

    Populated at registration time rather than extracted dynamically
    from a built graph — graph shape doesn't depend on the LLM, and
    static descriptors avoid an HTTP roundtrip per /api/agents call.
    If the graph topology drifts from the descriptor, the v2 live-
    activity work will catch it (it subscribes to actual SSE events,
    which name the active node).
    """

    nodes: list[AgentTopologyNode]
    edges: list[AgentTopologyEdge]


@dataclass
class AgentDescriptor:
    """Everything the Engine tab needs to surface an Agent.

    `config_model` is the Pydantic class that owns this Agent's
    tunables. /api/agents serialises it via model_json_schema() so the
    frontend can render a form; /api/chat/stream's incoming
    `agent_config[agent_id]` is validated through it before reaching
    the build_graph / @tool dispatch path.

    Make every field on the config_model optional (with `Field(default=...)`).
    The Engine tab sends partial overrides — only the fields the
    operator explicitly changed — so the validation path
    `model.model_validate(partial)` needs to succeed even with one
    key set.
    """

    id: str
    description: str
    config_model: type[BaseModel]
    topology: AgentTopology
    # Optional: list of tool names this Agent binds. Lets the UI render
    # "bound tools" chips on each Agent card and link Tools that wrap
    # sub-Agents back to those Agents (e.g. `research` tool → Research
    # Agent in the same tab).
    tools: list[str] = field(default_factory=list)


# Registry. Populated at import time by each Agent module.
AGENTS: dict[str, AgentDescriptor] = {}


def register_agent(desc: AgentDescriptor) -> None:
    """Register an Agent for discovery via /api/agents.

    Idempotent: re-registering the same id replaces the prior entry.
    Predictable for dev hot-reload — no duplicate entries after a
    module reload.
    """
    AGENTS[desc.id] = desc


def get_agent(agent_id: str) -> AgentDescriptor | None:
    """Look up an Agent by id."""
    return AGENTS.get(agent_id)


def default_config(agent_id: str) -> dict[str, Any]:
    """Materialise the default value of every field on an Agent.

    Used by the server when no override is supplied for a given field,
    and as the seed value for the frontend config form. The Pydantic
    model owns its own defaults so this is just `model_dump()` on a
    no-arg instance.
    """
    desc = AGENTS.get(agent_id)
    if not desc:
        return {}
    return desc.config_model().model_dump()


def validate_overrides(agent_id: str, partial: dict[str, Any]) -> dict[str, Any]:
    """Validate an incoming partial config against an Agent's model.

    Returns only the keys the caller explicitly set (via
    `model_dump(exclude_unset=True)`) so we don't pin stale defaults
    into the override dict when the field schema later evolves.
    Raises `pydantic.ValidationError` if the partial doesn't pass the
    Agent's constraints — let the server map that to a 422.
    """
    desc = AGENTS.get(agent_id)
    if not desc:
        return {}
    if not partial:
        return {}
    validated = desc.config_model.model_validate(partial)
    return validated.model_dump(exclude_unset=True)


__all__ = [
    "AgentDescriptor",
    "AgentTopology",
    "AgentTopologyNode",
    "AgentTopologyEdge",
    "AGENTS",
    "register_agent",
    "get_agent",
    "default_config",
    "validate_overrides",
]
