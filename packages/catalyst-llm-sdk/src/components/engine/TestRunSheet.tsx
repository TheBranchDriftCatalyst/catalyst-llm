/**
 * TestRunSheet — dispatch a one-off chat request through an Agent
 * directly from the Engine tab, without leaving the topology view.
 *
 * Triggered by clicking the __start__ chip on an Agent's topology
 * (today only `main` — sub-agents like `research` reach the runtime
 * via the `research` tool dispatched by main, so a standalone
 * test-run only makes sense from the parent entry point). The sheet
 * collects a one-shot user prompt + a Run button; on submit, it
 * streams the request via `agentClient.streamAgent` (same wire
 * shape chatStore uses) and surfaces the events as they arrive.
 *
 * Why a separate dispatch path (not chatStore.sendMessage):
 *   - chatStore is bound to a chat record (history, persisted
 *     messages, model selection from the chat panel). A test run is
 *     transient — it shouldn't pollute chat history or get
 *     persisted. We use the same `agentClient` underneath, but
 *     manage the events / view locally to the sheet.
 *
 * Phase A (this commit): dispatch + linear event log + final answer.
 * Phase B (TODO, llm-0mp): pipe the event stream's `node` attribution
 *   into ReactFlowAgentTopology.selectedNodeId so the active node
 *   pulses during the run.
 * Phase C (TODO, llm-0mp): clicking a node during/after a run opens
 *   a Sheet branch scoped to that node's events in this specific run.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Play, Square, Wrench } from "lucide-react";
import { useLLMContext } from "../../react/LLMProvider.js";
import { useEngineStore } from "../../react/engineStore.js";
import { usePromptStore } from "../../react/promptStore.js";
import type {
  AgentDescriptor,
  AgentEvent,
} from "../../agent/events.js";
import { ModelMicroSwitcher } from "../ModelMicroSwitcher.js";
import { cn } from "../utils.js";

export interface TestRunSheetProps {
  agent: AgentDescriptor;
  /** Called on every streamed event with the inferred active node id
   * (or `undefined` when idle). EngineView wires this into
   * ReactFlowAgentTopology.activeNodeId so the executing node pulses
   * live in the topology view. */
  onActiveNodeChange?: (nodeId: string | undefined) => void;
  className?: string;
}

interface DisplayState {
  status: "idle" | "streaming" | "done" | "error" | "cancelled";
  runId?: string;
  model?: string;
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
  }>;
  events: number;
  error?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
}

const EMPTY_DISPLAY: DisplayState = {
  status: "idle",
  content: "",
  toolCalls: [],
  events: 0,
};

/**
 * Walk the engineStore overrides + the prompt store to build a
 * prompt_overrides map for any system_prompt_ref bindings. Mirrors
 * the logic in chatStore.sendMessage but is local so the test run
 * stays decoupled from the chat dispatch path.
 */
function buildPromptOverrides(
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

export function TestRunSheet({
  agent,
  onActiveNodeChange,
  className,
}: TestRunSheetProps) {
  const { agentClient } = useLLMContext();
  const setField = useEngineStore((s) => s.setField);

  // Resolve which topology node id is the LLM-call node — for the
  // main agent it's "agent"; for research it's "members" (the
  // researcher node). Picked once per agent by scanning the topology
  // for the first `agent`-typed node that isn't a critic/fusion.
  // Used to attribute Token events to the right node when the wire
  // event doesn't carry explicit attribution.
  const llmNodeId = useMemo(() => {
    const agentNodes = agent.topology.nodes.filter((n) => n.type === "agent");
    // Heuristic: prefer "agent" (main), else "members" (research),
    // else the first agent-typed node.
    return (
      agentNodes.find((n) => n.id === "agent")?.id ??
      agentNodes.find((n) => n.id === "members")?.id ??
      agentNodes[0]?.id
    );
  }, [agent]);

  // Set of node ids that exist on this topology (lets us match
  // tool-call names like "web_search" to a topology node when one
  // exists with that id, instead of falling back to "tools").
  const nodeIds = useMemo(
    () => new Set(agent.topology.nodes.map((n) => n.id)),
    [agent],
  );

  // The model picker writes directly through to engineStore on the
  // LLM node — same state the node card's model chip reads from. This
  // is the source of truth for "what model will this agent dispatch
  // to" across the entire Engine tab; the picker here and the picker
  // on the node card always agree.
  const liveLLMNodeOverrides = useEngineStore(
    (s) => (llmNodeId ? s.configs[agent.id]?.[llmNodeId] : undefined),
  );
  const effectiveModel = useMemo(() => {
    const liveModel = liveLLMNodeOverrides?.model;
    if (typeof liveModel === "string" && liveModel.length > 0) return liveModel;
    const llmNode = llmNodeId
      ? agent.topology.nodes.find((n) => n.id === llmNodeId)
      : undefined;
    const defModel = llmNode?.config_defaults?.model;
    return typeof defModel === "string" ? defModel : "";
  }, [agent, liveLLMNodeOverrides, llmNodeId]);

  function setEffectiveModel(modelId: string) {
    if (!llmNodeId) return;
    setField(agent.id, llmNodeId, "model", modelId);
  }

  const [prompt, setPrompt] = useState("");
  const [display, setDisplay] = useState<DisplayState>(EMPTY_DISPLAY);
  const abortRef = useRef<AbortController | null>(null);

  const isRunning = display.status === "streaming";
  const canRun = prompt.trim().length > 0 && !isRunning && !!agentClient;

  const dispatch = useCallback(async () => {
    if (!canRun) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setDisplay({
      ...EMPTY_DISPLAY,
      status: "streaming",
    });
    onActiveNodeChange?.("__start__");

    // Wire shape mirrors chatStore.sendMessage — same backend code path,
    // so per-node overrides + prompt refs Just Work. The model is set
    // via engineStore (same picker as the node card), so it flows
    // through agent_config; request.model is a backstop default the
    // server only falls back to if no node override is present.
    const agentConfig = useEngineStore.getState().asRequestPayload();
    const promptOverrides = buildPromptOverrides(agentConfig);

    try {
      const stream = agentClient.streamAgent(
        {
          model: effectiveModel,
          messages: [{ role: "user", content: prompt }],
          tools: agent.tools.length > 0 ? agent.tools : undefined,
          agent_config: agentConfig,
          prompt_overrides: promptOverrides,
        },
        { signal: ctrl.signal },
      );

      for await (const ev of stream) {
        applyEvent(setDisplay, ev);
        const active = deriveActiveNode(ev, llmNodeId, nodeIds);
        if (active !== undefined) onActiveNodeChange?.(active);
        if (ctrl.signal.aborted) break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDisplay((d) => ({
        ...d,
        status: ctrl.signal.aborted ? "cancelled" : "error",
        error: msg,
      }));
    } finally {
      abortRef.current = null;
      // Land on __end__ once the stream is fully drained — gives the
      // visual a "this is where we stopped" anchor instead of just
      // freezing on whatever the last event happened to be.
      onActiveNodeChange?.("__end__");
    }
  }, [
    agent,
    agentClient,
    canRun,
    effectiveModel,
    llmNodeId,
    nodeIds,
    onActiveNodeChange,
    prompt,
  ]);

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    setDisplay(EMPTY_DISPLAY);
    onActiveNodeChange?.(undefined);
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      {/* ── Top: prompt input + model override + Run/Stop ─────────── */}
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{agent.id}</span>
          <span className="text-[10px] uppercase tracking-wider">
            test run · dispatches through the langgraph flow
          </span>
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Ask ${agent.id} something…  (⌘/Ctrl+Enter to run)`}
          rows={4}
          className="font-mono text-xs"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
              e.preventDefault();
              void dispatch();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            model
          </label>
          {/* Same picker the node cards use — writes through to the
           * SAME engineStore field, so the picker on this sheet and
           * the picker on the agent node card always read the same
           * value. No separate "test-run model" concept; changing
           * the model here changes it everywhere this Agent is used
           * (including the Chat tab's main agent dispatches). */}
          <div className="flex-1">
            <ModelMicroSwitcher
              value={effectiveModel}
              onChange={(v) => setEffectiveModel(v)}
            />
          </div>
          {isRunning ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={stop}
              className="h-7 text-xs"
            >
              <Square className="mr-1 h-3 w-3" aria-hidden="true" />
              stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => void dispatch()}
              disabled={!canRun}
              className="h-7 text-xs"
              title="Cmd/Ctrl-Enter from the prompt"
            >
              <Play className="mr-1 h-3 w-3" aria-hidden="true" />
              run
            </Button>
          )}
          {display.status !== "idle" && !isRunning && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              className="h-7 text-xs"
            >
              clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Bottom: output (flex-1, scrolls) ──────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/30">
        {display.status === "idle" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <div>
              <p className="mb-1">No output yet.</p>
              <p className="text-xs">
                Type a prompt above and hit{" "}
                <span className="font-mono">run</span>.
              </p>
            </div>
          </div>
        ) : (
          <RunOutput display={display} />
        )}
      </div>
    </div>
  );
}

/**
 * Map a streamed AgentEvent to the topology node that's "currently
 * active" right now. Used for the live-highlight on the topology
 * (Phase B). The server doesn't emit explicit node attribution on
 * every event, so we infer:
 *
 *   - run_started     → __start__ (handled at dispatch entry, not here)
 *   - token           → the LLM node (e.g. "agent" for main, "members"
 *                       for research). Identified by topology type at
 *                       caller time.
 *   - tool_call_start → either the exact node id matching the tool name
 *                       (e.g. research's "web_search" node), or the
 *                       generic "tools" dispatcher if no exact match.
 *   - tool_call_end   → back to the LLM node (we're about to feed the
 *                       tool result back into the model).
 *   - iteration       → also the LLM node (one more loop entry).
 *   - message_done /
 *     error /
 *     cancelled       → __end__ (handled at exit, not here).
 *
 * Returns `undefined` for events we don't care to highlight on.
 */
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
      // Prefer the exact node-id match (e.g. research has a "web_search"
      // node that IS the tool). Fall back to a generic "tools"
      // dispatcher node if one exists on the topology.
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

function applyEvent(
  set: React.Dispatch<React.SetStateAction<DisplayState>>,
  ev: AgentEvent,
) {
  set((d) => {
    const next: DisplayState = { ...d, events: d.events + 1 };
    switch (ev.type) {
      case "run_started":
        next.runId = ev.run_id;
        next.model = ev.model;
        return next;
      case "token":
        next.content = d.content + ev.content;
        return next;
      case "tool_call_start":
        next.toolCalls = [
          ...d.toolCalls,
          { id: ev.id, name: ev.name, args: ev.args },
        ];
        return next;
      case "tool_call_end": {
        next.toolCalls = d.toolCalls.map((c) =>
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
      }
      case "message_done":
        next.status = "done";
        next.finishReason = ev.finish_reason;
        next.usage = ev.usage;
        return next;
      case "error":
        next.status = "error";
        next.error = ev.message;
        return next;
      case "cancelled":
        next.status = "cancelled";
        return next;
      default:
        return next;
    }
  });
}

function RunOutput({ display }: { display: DisplayState }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Status strip */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-1.5 text-[11px]">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            display.status === "streaming" &&
              "bg-primary/15 text-primary animate-pulse",
            display.status === "done" && "bg-emerald-500/15 text-emerald-200",
            display.status === "error" && "bg-rose-500/15 text-rose-200",
            display.status === "cancelled" &&
              "bg-amber-500/15 text-amber-200",
          )}
        >
          {display.status}
        </span>
        {display.model && (
          <span className="font-mono text-muted-foreground">
            {display.model}
          </span>
        )}
        {display.runId && (
          <span className="font-mono text-[10px] text-muted-foreground">
            #{display.runId.slice(0, 8)}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {display.events} events
        </span>
      </div>

      {/* Tool calls */}
      {display.toolCalls.length > 0 && (
        <div className="border-b border-border/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Wrench className="h-3 w-3" aria-hidden="true" />
            tool calls ({display.toolCalls.length})
          </div>
          <div className="space-y-1">
            {display.toolCalls.map((c) => (
              <div
                key={c.id}
                className="rounded-sm border border-border/40 bg-muted/10 px-2 py-1 text-[11px]"
              >
                <div className="flex items-center justify-between font-mono">
                  <span>{c.name}</span>
                  {c.durationMs !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      {c.durationMs}ms
                    </span>
                  )}
                </div>
                <pre className="mt-0.5 overflow-x-auto text-[10px] text-muted-foreground">
                  {JSON.stringify(c.args, null, 2)}
                </pre>
                {c.error && (
                  <div className="mt-1 text-[10px] text-destructive">
                    error: {c.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assistant content (accumulated tokens) */}
      {display.content && (
        <div className="flex-1 whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-relaxed">
          {display.content}
        </div>
      )}

      {display.error && (
        <div className="border-t border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {display.error}
        </div>
      )}

      {display.status === "done" && display.usage && (
        <div className="border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
          finish: {display.finishReason ?? "?"} · usage:{" "}
          {JSON.stringify(display.usage)}
        </div>
      )}
    </div>
  );
}
