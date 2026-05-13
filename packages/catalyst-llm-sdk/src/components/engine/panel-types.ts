/**
 * Shared types for the LangGraphEnginePanel sub-components.
 *
 * The panel was ported from langgraph-dev/web/src/components/shell/EngineTab.tsx
 * but lives in catalyst-llm-sdk so any consumer that emits our
 * AgentDescriptor + AgentEvent shapes can mount it.
 *
 * The `PanelEvent` shape is a NORMALISED projection of our typed
 * AgentEvent union — flat-ish, with a `kind` discriminator that maps
 * 1:1 to AgentEvent.type, plus the bookkeeping (seq, ts, owner_tool_id)
 * the panel's sub-components share. Adapter is in `./adapters.ts`.
 */
import type { AgentDescriptor, AgentEventType } from "../../agent/events.js";

/**
 * A single event normalised for the panel's sub-components.
 *
 * - `seq` is the panel's own monotonic counter (we synthesise it client-
 *   side as events arrive, since the SSE wire doesn't carry it).
 * - `ts` is wall-clock ms at the moment the event was applied (NOT
 *   server-side timestamp; that's only available for historical loads).
 * - `kind` mirrors AgentEvent.type 1:1 so consumers can switch on it.
 * - `node` is the topology node id this event is attributed to. For
 *   sub-events nested under a tool call, we set `node` to the most
 *   specific matching node id when one exists on the topology (e.g.
 *   "web_search" for a tool_call_start whose name matches a node id),
 *   else fall back to the LLM node or "__start__"/"__end__" for the
 *   lifecycle events.
 * - `ownerToolId` carries the AgentEvent's owner_tool_id mixin verbatim
 *   so the right-side NodePanel + Terminal can render sub-events under
 *   their parent tool call.
 * - `payload` is the original AgentEvent (sans the lifted fields above)
 *   so detail pane can show full JSON.
 */
export interface PanelEvent {
  seq: number;
  ts: number;
  kind: AgentEventType;
  node: string;
  ownerToolId?: string;
  payload: Record<string, unknown>;
}

/**
 * Status derived from the event stream for a given topology node.
 * Driven by useNodeStatus(events) and consumed by the topology card
 * to render a status dot + latency chip. Phase 3e wires this in.
 */
export interface NodeStatus {
  /** idle = never seen; running = mid-call (start with no end); ok =
   * last seen event was a successful end; error = last seen event was
   * an error. */
  state: "idle" | "running" | "ok" | "error";
  /** Wall-clock ms for the most recent completed call on this node,
   * OR the elapsed since `tool_call_start` if currently running. */
  latencyMs?: number;
  /** Cumulative call count on this node within the run. */
  calls: number;
  /** Cumulative error count on this node within the run. */
  errors: number;
}

/**
 * What a NodePanel selection points at. `ownerToolId` lets the right
 * pane narrow to events from a specific parent tool's scope (e.g.
 * "show me the critic events that ran INSIDE this research dispatch").
 * `null` = no selection.
 */
export interface PanelSelection {
  nodeId: string;
  ownerToolId: string | null;
}

/**
 * Props every LangGraphEnginePanel sub-component shares. Keeps the
 * dependency surface explicit and lets tests render the panel with
 * stub data.
 */
export interface PanelContext {
  agent: AgentDescriptor;
  events: PanelEvent[];
  /** When set, downstream views should filter to events with ts ≤ scrubT
   * (time-travel). Null = render the full / live event log. */
  scrubT: number | null;
}
