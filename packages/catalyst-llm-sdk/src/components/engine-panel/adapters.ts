/**
 * Adapters between our AgentEvent union (the SSE wire shape) and the
 * panel's normalised PanelEvent.
 *
 * Lives separately from the components so the projection logic stays
 * testable + reusable from any future panel surface (a CLI viewer, a
 * Jupyter widget, etc.) that wants the same normalised event flow.
 */
import type { AgentDescriptor, AgentEvent } from "../../agent/events.js";
import type { PanelEvent } from "./types.js";

/**
 * Project one AgentEvent into a PanelEvent. `seq` and `ts` are caller-
 * supplied — the caller (engineRunStore consumer) knows the seq counter
 * for the run and uses Date.now() for live events; for historical loads
 * the server supplies both.
 *
 * `nodeIds` is the set of topology node ids on the agent. Used to
 * attribute tool_call_start/end to the matching node when the tool name
 * is also a node id (e.g. research has a "web_search" node that IS the
 * tool); otherwise falls back to the generic "tools" dispatcher if one
 * exists, else the event's own kind-derived node ("__start__"/"__end__"/
 * "error" for lifecycle events).
 *
 * `llmNodeId` is the LLM-call node for the agent (e.g. "agent" for
 * main, "members" for research). Used for token/reasoning attribution.
 */
export function agentEventToPanelEvent(
  ev: AgentEvent,
  seq: number,
  ts: number,
  llmNodeId: string | undefined,
  nodeIds: Set<string>,
): PanelEvent {
  // Pull owner_tool_id off the wire — present on the Nestable family.
  const ownerToolId = (ev as { owner_tool_id?: string | null })
    .owner_tool_id;

  let node: string;
  switch (ev.type) {
    case "run_started":
      node = "__start__";
      break;
    case "token":
    case "reasoning":
    case "iteration":
      // Token/reasoning attribution: if the LLM node id exists on the
      // topology, attribute there; else fall back to the generic "agent".
      node = llmNodeId ?? "agent";
      break;
    case "tool_call_start":
    case "tool_call_end":
      // Prefer an exact node-id match for the tool name (research has
      // distinct nodes for web_search etc); fall back to a generic
      // "tools" dispatcher node when no exact match.
      if (ev.type === "tool_call_start" && nodeIds.has(ev.name)) {
        node = ev.name;
      } else if (nodeIds.has("tools")) {
        node = "tools";
      } else {
        node = "tools";
      }
      break;
    case "message_done":
    case "cancelled":
      node = "__end__";
      break;
    case "error":
      node = "error";
      break;
    default:
      node = "unknown";
  }

  // Strip lifted fields from the payload — they live as top-level
  // PanelEvent properties, no need to duplicate.
  const { type: _kind, ...rest } = ev as { type: string; [k: string]: unknown };
  if ("owner_tool_id" in rest) delete (rest as { owner_tool_id?: unknown }).owner_tool_id;

  return {
    seq,
    ts,
    kind: ev.type,
    node,
    ownerToolId: ownerToolId ?? undefined,
    payload: rest,
  };
}

/**
 * Pull the LLM-call node id out of an AgentDescriptor. Used by both the
 * adapter (for event attribution) and the topology renderer.
 *
 *   main     → "agent"
 *   research → "members"
 *   other    → first `agent`-typed node, or undefined if none
 */
export function resolveLLMNodeId(
  agent: AgentDescriptor,
): string | undefined {
  const agentNodes = agent.topology.nodes.filter((n) => n.type === "agent");
  return (
    agentNodes.find((n) => n.id === "agent")?.id ??
    agentNodes.find((n) => n.id === "members")?.id ??
    agentNodes[0]?.id
  );
}

/**
 * Memo helper — the panel components use this to avoid recomputing the
 * node-id set on every render.
 */
export function topologyNodeIds(agent: AgentDescriptor): Set<string> {
  return new Set(agent.topology.nodes.map((n) => n.id));
}
