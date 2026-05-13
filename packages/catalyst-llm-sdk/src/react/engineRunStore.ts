/**
 * Engine test-run store — keeps a running dispatch alive across UI
 * navigation.
 *
 * Originally the TestRunSheet held the entire run state in local
 * useState; when the sheet closed (Esc, switch agents, click out)
 * the component unmounted and the state vanished. The server-side
 * stream kept running but nothing was consuming its events. Lift
 * the state here so the sheet (and any other watcher — the topology
 * needs the active node id to drive its pulse highlight) can read
 * the live state, and a re-mount picks up where it left off.
 *
 * Per-agent keying: at most one in-flight test run per Agent at a
 * time. Starting a new run while one is in flight aborts the old
 * one. Two different Agents can run concurrently — they live under
 * different keys in `runs`.
 *
 * AbortControllers are stored in a module-level map (they're not
 * serialisable so they don't belong in zustand state). The store
 * doesn't persist to localStorage — a refresh kills any in-flight
 * run on the server side too (TCP disconnect → cancellation), so
 * there's no reason to rehydrate stale display state.
 */
import { create } from "zustand";
import type { AgentDescriptor, AgentEvent } from "../agent/events.js";
import type { CatalystAgentClient } from "../agent/index.js";
import {
  agentEventToPanelEvent,
  resolveLLMNodeId,
  topologyNodeIds,
} from "../components/engine/adapters.js";
import type { PanelEvent } from "../components/engine/panel-types.js";
import { useEngineStore } from "./engineStore.js";
import { usePromptStore } from "./promptStore.js";

export interface RunToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export type RunStatus =
  | "streaming"
  | "done"
  | "error"
  | "cancelled";

export interface RunDisplay {
  /** The prompt the operator sent. Carried so a returning viewer
   * can see what kicked the run off. */
  prompt: string;
  /** The model id actually used. May differ from the operator's
   * picker value if the server's effective_model fallback chain
   * resolved to something else. */
  model?: string;
  status: RunStatus;
  runId?: string;
  /** Accumulating assistant tokens. */
  content: string;
  toolCalls: RunToolCall[];
  /** Last node id the stream attributed an event to. Drives the
   * topology pulse highlight. Cleared when the operator clears
   * the run output. */
  activeNodeId?: string;
  /** Count of streamed events (any type) — useful as a heartbeat
   * indicator for the operator. */
  events: number;
  /** Backend error or fetch-layer error. */
  error?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
  /** Wall-clock start of the dispatch. */
  startedAt: number;
  /** Wall-clock end (set on done/error/cancelled). */
  endedAt?: number;
  /**
   * Raw event log normalised into PanelEvent shape — feeds the
   * LangGraphEnginePanel sub-components (EventStream / RunTimeline /
   * NodePanel / Terminal). Includes every kind (token, reasoning,
   * iteration, tool_call_*, message_done, error, cancelled) so the
   * panel renders the full trace, not just the projected
   * content/toolCalls fields above.
   */
  panelEvents: PanelEvent[];
}

export interface StartRunArgs {
  agent: AgentDescriptor;
  agentClient: CatalystAgentClient;
  prompt: string;
  /** The model to dispatch. Caller's responsibility to resolve from
   * engineStore + topology defaults; the store just passes through. */
  model: string;
  /**
   * The agent-side topology node id whose Token events should be
   * attributed to. Used by the in-store node-attribution heuristic.
   * Typically "agent" (main) or "members" (research).
   */
  llmNodeId: string | undefined;
  /** Set of node ids on the topology — used to resolve tool-call
   * names to matching nodes. */
  nodeIds: Set<string>;
}

interface EngineRunStore {
  /** keyed by agent id */
  runs: Record<string, RunDisplay>;

  /** Start a run for an agent. If one is already in flight for this
   * agent, the previous AbortController is aborted first. Returns
   * when the stream ends (or rejects on a non-cancellation error). */
  startRun: (args: StartRunArgs) => Promise<void>;
  /** Cancel an in-flight run for an agent. No-op if none in flight. */
  stopRun: (agentId: string) => void;
  /** Drop the display state for an agent. No-op if no record. */
  clearRun: (agentId: string) => void;
}

// AbortControllers can't live in zustand state (non-serialisable +
// React would re-render on every change). Module-level map keyed by
// agentId is fine since the store is also a module-level singleton.
const ABORTERS = new Map<string, AbortController>();

function deriveActiveNode(
  ev: AgentEvent,
  llmNodeId: string | undefined,
  nodeIds: Set<string>,
): string | undefined {
  switch (ev.type) {
    case "run_started":
      return "__start__";
    case "token":
    case "iteration":
      return llmNodeId;
    case "tool_call_start":
      if (nodeIds.has(ev.name)) return ev.name;
      if (nodeIds.has("tools")) return "tools";
      return undefined;
    case "tool_call_end":
      return llmNodeId;
    case "message_done":
    case "cancelled":
    case "error":
      return "__end__";
    default:
      return undefined;
  }
}

function applyEvent(prev: RunDisplay, ev: AgentEvent): RunDisplay {
  const next: RunDisplay = { ...prev, events: prev.events + 1 };
  switch (ev.type) {
    case "run_started":
      next.runId = ev.run_id;
      next.model = ev.model;
      return next;
    case "token":
      next.content = prev.content + ev.content;
      return next;
    case "tool_call_start":
      next.toolCalls = [
        ...prev.toolCalls,
        { id: ev.id, name: ev.name, args: ev.args },
      ];
      return next;
    case "tool_call_end":
      next.toolCalls = prev.toolCalls.map((c) =>
        c.id === ev.id
          ? {
              ...c,
              result: ev.result,
              error: ev.error,
              durationMs: ev.duration_ms,
            }
          : c,
      );
      return next;
    case "message_done":
      next.status = "done";
      next.finishReason = ev.finish_reason;
      next.usage = ev.usage;
      next.endedAt = Date.now();
      return next;
    case "error":
      next.status = "error";
      next.error = ev.message;
      next.endedAt = Date.now();
      return next;
    case "cancelled":
      next.status = "cancelled";
      next.endedAt = Date.now();
      return next;
    default:
      return next;
  }
}

/** Walk an agent_config map and build a `prompt_overrides` payload
 * resolving every `system_prompt_ref` to the matching saved-prompt
 * content. Mirrors chatStore.collectPromptOverrides — duplicated
 * intentionally to keep this store standalone (the chat dispatch
 * pipeline doesn't import this one). */
function collectPromptOverrides(
  agentConfig:
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined,
): Record<string, string> | undefined {
  if (!agentConfig) return undefined;
  const refIds = new Set<string>();
  for (const nodeCfgs of Object.values(agentConfig)) {
    if (!nodeCfgs) continue;
    for (const fields of Object.values(nodeCfgs)) {
      if (!fields) continue;
      const ref = fields["system_prompt_ref"];
      if (typeof ref === "string" && ref.length > 0) refIds.add(ref);
    }
  }
  if (refIds.size === 0) return undefined;
  const presets = usePromptStore.getState().presets;
  const byId = new Map(presets.map((p) => [p.id, p]));
  const out: Record<string, string> = {};
  for (const id of refIds) {
    const p = byId.get(id);
    if (p?.systemPrompt) out[id] = p.systemPrompt;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const useEngineRunStore = create<EngineRunStore>()((set, get) => ({
  runs: {},

  async startRun({ agent, agentClient, prompt, model, llmNodeId, nodeIds }) {
    // Abort any in-flight run for this agent before starting a new one.
    // Previous run's status flips to "cancelled" via its catch path.
    ABORTERS.get(agent.id)?.abort();
    const ctrl = new AbortController();
    ABORTERS.set(agent.id, ctrl);

    set((s) => ({
      runs: {
        ...s.runs,
        [agent.id]: {
          prompt,
          model,
          status: "streaming",
          content: "",
          toolCalls: [],
          activeNodeId: "__start__",
          events: 0,
          startedAt: Date.now(),
          panelEvents: [],
        },
      },
    }));

    // llmNodeId + nodeIds are passed in by the caller (see
    // StartRunArgs above); they're the same values the adapter
    // wants. panelSeq is local — a fresh counter per dispatch.
    let panelSeq = 0;

    const agentConfig = useEngineStore.getState().asRequestPayload();
    const promptOverrides = collectPromptOverrides(agentConfig);

    try {
      const stream = agentClient.streamAgent(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          tools: agent.tools.length > 0 ? agent.tools : undefined,
          agent_config: agentConfig,
          prompt_overrides: promptOverrides,
        },
        { signal: ctrl.signal },
      );
      for await (const ev of stream) {
        if (ctrl.signal.aborted) break;
        const active = deriveActiveNode(ev, llmNodeId, nodeIds);
        const panelEv = agentEventToPanelEvent(
          ev,
          panelSeq++,
          Date.now(),
          llmNodeId,
          nodeIds,
        );
        set((s) => {
          const prev = s.runs[agent.id];
          if (!prev) return s; // operator cleared mid-stream
          const next = applyEvent(prev, ev);
          if (active !== undefined) next.activeNodeId = active;
          next.panelEvents = [...prev.panelEvents, panelEv];
          return { runs: { ...s.runs, [agent.id]: next } };
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => {
        const prev = s.runs[agent.id];
        if (!prev) return s;
        return {
          runs: {
            ...s.runs,
            [agent.id]: {
              ...prev,
              status: ctrl.signal.aborted ? "cancelled" : "error",
              error: msg,
              endedAt: Date.now(),
            },
          },
        };
      });
    } finally {
      // Set the terminal pulse to __end__ if we were the active
      // controller (a newer run may have superseded us — don't
      // stomp on its highlight).
      if (ABORTERS.get(agent.id) === ctrl) {
        ABORTERS.delete(agent.id);
        set((s) => {
          const prev = s.runs[agent.id];
          if (!prev) return s;
          return {
            runs: {
              ...s.runs,
              [agent.id]: { ...prev, activeNodeId: "__end__" },
            },
          };
        });
      }
    }
  },

  stopRun(agentId) {
    ABORTERS.get(agentId)?.abort();
  },

  clearRun(agentId) {
    ABORTERS.get(agentId)?.abort();
    ABORTERS.delete(agentId);
    set((s) => {
      if (!(agentId in s.runs)) return s;
      const next = { ...s.runs };
      delete next[agentId];
      return { runs: next };
    });
  },
}));
