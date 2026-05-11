"""Agent registry — central source of truth for what the Engine tab sees.

An "Agent" here is a compiled LangGraph state machine that owns an LLM
and a loop. Today: the main chat agent (`main`) and the research
sub-agent (`research`). Each module that defines an Agent calls
`register_agent(...)` at import time; the playground's Engine tab
fetches the merged registry via `GET /api/agents` and renders each
Agent's topology + config form.

Why a purpose-built schema (`AgentField` / `AgentDescriptor`) instead of
LangGraph's built-in `Runnable.config_specs`:
  - We need UI affordances `config_specs` doesn't carry (slider min/max,
    `type="model"` hooks into the existing ModelSelector dropdown, secret
    flags, enum option lists).
  - 30 lines of dataclass is less awkward than retrofitting
    `Configurable` / `ConfigurableField` into both graphs *and* writing
    a frontend adapter for the spec shape.
The trade-off: we own the schema, so we own the migration story when
fields shift. Worth it for the UI control.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional


FieldType = Literal["model", "number", "string", "bool", "enum"]
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
class AgentField:
    """One tunable knob on an Agent.

    `type` drives renderer choice on the frontend:
      - "model"  → existing ModelSelector dropdown (populated from /api/models)
      - "number" → catalyst-ui Slider (uses min/max/step)
      - "string" → catalyst-ui Input (short) or Textarea (use `multiline=True`)
      - "bool"   → Switch
      - "enum"   → Select (use `options=[...]`)
    """

    name: str
    type: FieldType
    default: Any
    label: str
    description: str = ""
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[list[str]] = None
    multiline: bool = False
    secret: bool = False


@dataclass
class AgentDescriptor:
    """Everything the Engine tab needs to surface an Agent.

    `topology` is a static snapshot of the graph shape (see
    `AgentTopology` above). It's NOT extracted from a compiled graph
    at request time — request-time graph construction still flows
    through the existing `build_graph()` / research `@tool` paths,
    parameterised by `agent_config` overrides.
    """

    id: str
    description: str
    config_schema: list[AgentField]
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
    That makes hot-reload during dev predictable (no duplicate entries
    after a module reload).
    """
    AGENTS[desc.id] = desc


def get_agent(agent_id: str) -> Optional[AgentDescriptor]:
    """Look up an Agent by id. Returns None if not registered."""
    return AGENTS.get(agent_id)


def default_config(agent_id: str) -> dict[str, Any]:
    """Materialise the default value of every field on an Agent.

    Used by the server when no override is supplied for a given field,
    and as the seed value for the frontend config form.
    """
    desc = AGENTS.get(agent_id)
    if not desc:
        return {}
    return {f.name: f.default for f in desc.config_schema}


__all__ = [
    "AgentField",
    "AgentDescriptor",
    "AgentTopology",
    "AgentTopologyNode",
    "AgentTopologyEdge",
    "AGENTS",
    "register_agent",
    "get_agent",
    "default_config",
]
