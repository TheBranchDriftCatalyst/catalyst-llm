/**
 * TypeScript mirror of catalyst-langgraph's AgentEvent union.
 *
 * The Python source of truth lives at
 *   packages/catalyst-langgraph/src/catalyst_langgraph/events.py
 *
 * Each event in the union carries a discriminating `type` field so
 * consumers can switch over it (or filter via `event.type === "token"`)
 * without runtime tag inspection. Keep this file in lock-step with
 * the Python schema — adding an event there but not here means the
 * UI silently drops events; vice-versa means we'll log "unknown type"
 * warnings until the backend ships matching code.
 */

/**
 * Mixin for events that can be nested inside a tool execution. When
 * `owner_tool_id` is set, the event was produced INSIDE that tool
 * call (e.g. a council member's tokens while `research` is running);
 * the UI routes such events into the parent tool card's expandable
 * "reasoning" section rather than accumulating them on the
 * assistant turn's main content. When null/undefined, the event came
 * from the parent agent and renders inline as before.
 */
export interface Nestable {
  owner_tool_id?: string | null;
}

export interface RunStarted {
  type: "run_started";
  run_id: string;
  model: string;
}

export interface Token extends Nestable {
  type: "token";
  content: string;
}

/** Reasoning-trace deltas (e.g. `<think>` blocks from r1-style models). */
export interface Reasoning extends Nestable {
  type: "reasoning";
  content: string;
}

export interface ToolCallStart extends Nestable {
  type: "tool_call_start";
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallEnd extends Nestable {
  type: "tool_call_end";
  id: string;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

export interface Iteration extends Nestable {
  type: "iteration";
  n: number;
}

export interface MessageDone {
  type: "message_done";
  finish_reason?: string;
  usage?: Record<string, unknown>;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

/**
 * Terminal event yielded when the run was cancelled cooperatively —
 * the UI pressed STOP (or the client disconnected) and the server
 * propagated the signal to sub-agents before closing the stream.
 * Treat like `message_done` with `finish_reason="abort"` plus the
 * extra signal that the cancel was structured (sub-agents heard it,
 * tool_call_end events were synthesised for in-flight tools) rather
 * than just-dropped-the-tcp-connection.
 */
export interface Cancelled {
  type: "cancelled";
  /** Why the run was cancelled. `client_abort` = the SSE consumer
   * disconnected (UI pressed STOP / closed the tab). `timeout`
   * reserved for future server-side caps. */
  reason: string;
  /** Best-effort list of in-flight tool_call_ids the cancel was
   * signalled to. Empty / null when nothing was in flight. */
  propagated_to?: string[] | null;
}

export type AgentEvent =
  | RunStarted
  | Token
  | Reasoning
  | ToolCallStart
  | ToolCallEnd
  | Iteration
  | MessageDone
  | ErrorEvent
  | Cancelled;

/** All event-type discriminators in one place, useful for exhaustiveness checks. */
export const AGENT_EVENT_TYPES = [
  "run_started",
  "token",
  "reasoning",
  "tool_call_start",
  "tool_call_end",
  "iteration",
  "message_done",
  "error",
  "cancelled",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Body shape for POST /api/chat/stream. */
export interface ChatStreamRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
    [key: string]: unknown;
  }>;
  system_prompt?: string;
  /** Tool names the agent may dispatch (must be in /api/tools). */
  tools?: string[];
  /** Sampling params: temperature, max_tokens, top_p, reasoning_effort, … */
  params?: Record<string, unknown>;
  /**
   * Per-node overrides for tunables advertised on GET /api/agents.
   * Shape: `{ "<agent_id>": { "<node_id>": { field: value, ... }, ... }, ... }`.
   * Each innermost dict is validated server-side against the matching
   * node's Pydantic config_model. Falls back to defaults when absent.
   *
   * Example:
   *   { main: { agent: { recursion_limit: 30, temperature: 0.5 } },
   *     research: { members: { model: "claude-haiku-4-5-20251001" },
   *                 critic:  { enabled: true } } }
   */
  agent_config?: Record<string, Record<string, Record<string, unknown>>>;
  /**
   * Resolution map for `system_prompt_ref` values referenced in
   * agent_config. The server replaces a node's `system_prompt` with
   * the resolved content when a ref matches. Refs without a match
   * fall through to the node's inline `system_prompt` or schema
   * default. Built client-side by chatStore from PromptStore.
   */
  prompt_overrides?: Record<string, string>;
}

// ─── Agent registry types (mirror /api/agents schema) ─────────────────

/** Structural-grouping style for compound containers on the topology canvas.
 *
 * `ensemble` — visually suggests "N parallel copies of this thing"
 *   (faint container, e.g. a Mixture-of-Experts gate around expert nodes).
 * `actor_critic_loop` — dashed container around generator + critic +
 *   (optional) fusion participants; conveys the feedback semantics
 *   without requiring the operator to read the edges.
 */
export type GroupType = "ensemble" | "actor_critic_loop";

/** One node in an Agent's topology graph.
 *
 * `config_schema` (JSON Schema from the node's Pydantic class) and
 * `config_defaults` (no-arg instance dump) are non-null only for nodes
 * that actually consume operator-tweakable knobs — start/end terminals
 * and pure-dispatch tools nodes leave both as null.
 *
 * Optional structural-grouping metadata (UI-only — does not affect the
 * runtime LangGraph state machine):
 *   - `group_id` — nodes sharing the same group_id render inside the
 *     same compound container on the Engine tab.
 *   - `group_type` — sets the container's visual style.
 *   - `instance_count_field` — when set, names a field in *this* node's
 *     own `config_schema` whose live value drives how many small
 *     "instance" sub-cards the UI stamps inside the node card. Visual
 *     only; the sub-cards are not separately configurable.
 */
export interface AgentTopologyNode {
  id: string;
  type: "start" | "end" | "agent" | "tools";
  config_schema: AgentConfigSchema | null;
  config_defaults: Record<string, unknown> | null;
  group_type?: GroupType | null;
  group_id?: string | null;
  instance_count_field?: string | null;
}

/** One edge between two topology nodes. */
export interface AgentTopologyEdge {
  source: string;
  target: string;
  conditional: boolean;
}

/** Static topology snapshot for the Engine tab to render. */
export interface AgentTopology {
  nodes: AgentTopologyNode[];
  edges: AgentTopologyEdge[];
}

/**
 * UI hints attached to a property in the JSON Schema returned by
 * GET /api/agents. Lives at `properties.<field>.ui` and drives the
 * AgentConfigForm's widget choice:
 *   - `widget: "model"`     → ModelSelector dropdown (populated from /api/models)
 *   - `widget: "textarea"`  → multi-line Textarea
 *   - undefined / no widget → renderer picks by JSON Schema `type`:
 *                              number → Slider, string → Input,
 *                              boolean → Switch, enum → Select
 * `step` and `secret` are passed verbatim to the chosen widget.
 */
export interface AgentFieldUiHints {
  widget?: "model" | "textarea" | "hidden";
  step?: number;
  secret?: boolean;
}

/**
 * One property entry within an Agent's JSON Schema. Mirrors the
 * subset of JSON Schema (draft 2020-12) that the backend's
 * Pydantic-derived schemas emit. The `ui` extension key is ours.
 */
export interface AgentFieldSchema {
  type: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  enum?: string[];
  ui?: AgentFieldUiHints;
}

/**
 * JSON Schema for an Agent's config_model — exactly what
 * Pydantic's `model.model_json_schema()` produces, with our `ui`
 * extension hints sprinkled onto individual properties.
 */
export interface AgentConfigSchema {
  type: "object";
  title?: string;
  description?: string;
  properties?: Record<string, AgentFieldSchema>;
  required?: string[];
}

/** One Agent in the registry — everything the Engine tab needs to render it.
 *
 * Per-node config schemas live on `topology.nodes[].config_schema` (and
 * `.config_defaults`). There is no Agent-level config_schema — every
 * tunable is owned by the node that consumes it.
 */
export interface AgentDescriptor {
  id: string;
  description: string;
  tools: string[];
  topology: AgentTopology;
}

/** Response shape for GET /api/agents. */
export interface ListAgentsResponse {
  agents: AgentDescriptor[];
}
