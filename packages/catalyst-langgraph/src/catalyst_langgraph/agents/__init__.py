"""Agent registry — central source of truth for what the Engine tab sees.

An "Agent" here is a compiled LangGraph state machine — `main` (chat
loop), `research` (council). Each module that defines an Agent calls
`register_agent(...)` at import time; the playground's Engine tab fetches
the merged registry via `GET /api/agents` and renders each Agent's
topology with per-node config forms.

Schema model: **each LangGraph node owns its own Pydantic config class**.
That keeps the wire shape, the UI form layout, and the runtime
configuration aligned with the operator's mental model: when you click
the `critic` node in the topology, you see the critic's tunables — not
a flat `critic_*`-prefixed block on a single agent-wide form.

Each `AgentTopologyNode` optionally carries `config_model: type[BaseModel]`.
Nodes that don't take tunables (`__start__`, `__end__`, `tools` nodes)
leave it `None`. The descriptor endpoint emits per-node
`config_schema` (JSON Schema) + `config_defaults` (materialised
no-arg instance dump) so the frontend can drive the form.

UI affordances that JSON Schema doesn't natively carry (`widget="model"`,
`widget="textarea"`, custom slider `step`, `secret` flags) ride along in
`Field(..., json_schema_extra={"ui": {...}})`. The frontend renderer
reads that `ui` extension key to pick a widget.

Wire shape for per-request overrides:

  agent_config = {
      "<agent_id>": {
          "<node_id>": { field: value, ... },
          ...
      },
      ...
  }
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from pydantic import BaseModel


NodeType = Literal["start", "end", "agent", "tools"]
GroupType = Literal["ensemble", "actor_critic_loop"]


@dataclass
class AgentTopologyNode:
    """One node in an Agent's LangGraph topology.

    `config_model` is the Pydantic class owning *this node's* tunables —
    only the nodes that actually consume operator-tweakable knobs declare
    one. Leaf nodes (`__start__`, `__end__`) and inert dispatchers
    (`tools`) leave it `None`; the descriptor emits `config_schema: null`
    for those and the right-panel Config tab shows an empty state.

    Structural grouping (optional, UI-only):

      `group_id` — nodes sharing the same group_id render inside the
        same compound container on the Engine tab. Purely visual; the
        underlying LangGraph state machine is unchanged.
      `group_type` — sets the container's visual style. `ensemble`
        renders as a faint container suggesting parallel copies;
        `actor_critic_loop` renders with critic-feedback semantics
        (dashed border around the loop's participants).
      `instance_count_field` — names a field in *this* node's own
        config_model whose live value determines how many "instance"
        sub-cards to stamp inside the node card. Lets a single
        `members` node visualise `council_size=N` as N stamps without
        introducing N separately-configurable nodes.
    """

    id: str
    type: NodeType = "agent"
    config_model: type[BaseModel] | None = None
    group_type: Optional[GroupType] = None
    group_id: Optional[str] = None
    instance_count_field: Optional[str] = None


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
    """

    nodes: list[AgentTopologyNode]
    edges: list[AgentTopologyEdge]


@dataclass
class AgentDescriptor:
    """Everything the Engine tab needs to surface an Agent.

    Per-node config schemas live on `topology.nodes[].config_model`.
    No Agent-level config_model — every tunable is owned by the node
    that actually consumes it.
    """

    id: str
    description: str
    topology: AgentTopology
    # Optional: list of tool names this Agent binds. Lets the UI render
    # "bound tools" chips on each Agent card and link Tools that wrap
    # sub-Agents back to those Agents.
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


def _get_node(agent_id: str, node_id: str) -> AgentTopologyNode | None:
    desc = AGENTS.get(agent_id)
    if not desc:
        return None
    return next((n for n in desc.topology.nodes if n.id == node_id), None)


def node_default_config(agent_id: str, node_id: str) -> dict[str, Any]:
    """Materialise the default value of every field on one node's config.

    Returns `{}` for nodes with no `config_model` (start/end/tools).
    """
    node = _get_node(agent_id, node_id)
    if not node or node.config_model is None:
        return {}
    return node.config_model().model_dump()


def validate_overrides(
    agent_id: str, node_id: str, partial: dict[str, Any]
) -> dict[str, Any]:
    """Validate an incoming partial config against a node's Pydantic model.

    Returns only the keys the caller explicitly set (via
    `model_dump(exclude_unset=True)`) so we don't pin stale defaults
    into the override dict when the field schema later evolves.

    Returns `{}` when the partial is empty OR when the node has no
    `config_model` (leaf nodes, tools nodes). Raises
    `pydantic.ValidationError` if the partial doesn't pass the node's
    constraints — let the server map that to a 422.
    """
    if not partial:
        return {}
    node = _get_node(agent_id, node_id)
    if not node or node.config_model is None:
        return {}
    validated = node.config_model.model_validate(partial)
    return validated.model_dump(exclude_unset=True)


__all__ = [
    "AgentDescriptor",
    "AgentTopology",
    "AgentTopologyNode",
    "AgentTopologyEdge",
    "AGENTS",
    "register_agent",
    "get_agent",
    "node_default_config",
    "validate_overrides",
]
