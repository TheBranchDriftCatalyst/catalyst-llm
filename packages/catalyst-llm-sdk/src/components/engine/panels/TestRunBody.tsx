/**
 * TestRunBody — dispatch a one-off chat request through an Agent
 * directly from the Engine tab, without leaving the topology view.
 *
 * Triggered by clicking the __start__ chip on an Agent's topology.
 * The actual run lifecycle (AbortController, streaming, event-applied
 * state) lives in useEngineRunStore so the run survives this sheet's
 * unmount: if the operator closes the sheet, switches agents, or
 * collapses the panel, the server-side dispatch keeps streaming and
 * the topology highlight keeps updating; re-opening the sheet picks
 * up the live state.
 *
 * This component is essentially a thin view over `runs[agent.id]`
 * in the run store — input on top, store-driven output below.
 *
 * Phase A (commit 5910458): dispatch + linear event log
 * Phase B (commit e95d016): live node highlight
 * Phase C (TODO, llm-0mp): per-node run-event drill-down
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Play, Square, Wrench } from "lucide-react";
import { useLLMContext } from "../../../react/LLMProvider.js";
import { useEngineRunStore } from "../../../react/engineRunStore.js";
import { useEngineStore } from "../../../react/engineStore.js";
import type { AgentDescriptor } from "../../../agent/events.js";
import { ModelMicroSwitcher } from "../../model-selector/ModelMicroSwitcher.js";
import { cn } from "../../shared/utils.js";

export interface TestRunBodyProps {
  agent: AgentDescriptor;
  className?: string;
}

export function TestRunBody({ agent, className }: TestRunBodyProps) {
  const { agentClient } = useLLMContext();
  const setField = useEngineStore((s) => s.setField);

  // Run lifecycle — handled by the store.
  const display = useEngineRunStore((s) => s.runs[agent.id]);
  const startRun = useEngineRunStore((s) => s.startRun);
  const stopRun = useEngineRunStore((s) => s.stopRun);
  const clearRun = useEngineRunStore((s) => s.clearRun);

  // Resolve which topology node id is the LLM-call node — for the
  // main agent it's "agent"; for research it's "members". Used by
  // the store's heuristic to attribute Token events to the right
  // node when the wire event doesn't carry explicit attribution.
  const llmNodeId = useMemo(() => {
    const agentNodes = agent.topology.nodes.filter((n) => n.type === "agent");
    return (
      agentNodes.find((n) => n.id === "agent")?.id ??
      agentNodes.find((n) => n.id === "members")?.id ??
      agentNodes[0]?.id
    );
  }, [agent]);

  const nodeIds = useMemo(
    () => new Set(agent.topology.nodes.map((n) => n.id)),
    [agent],
  );

  // The model picker writes through to engineStore on the LLM node
  // — same state the node card's model chip reads from. Source of
  // truth for "what model will this agent dispatch to".
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

  // Prompt input is local — typing it shouldn't churn other watchers
  // through the store. Reset to "" after a dispatch.
  const [prompt, setPrompt] = useState("");

  const isRunning = display?.status === "streaming";
  const canRun =
    prompt.trim().length > 0 && !isRunning && !!agentClient && !!effectiveModel;

  const dispatch = useCallback(() => {
    if (!canRun || !agentClient) return;
    void startRun({
      agent,
      agentClient,
      prompt,
      model: effectiveModel,
      llmNodeId,
      nodeIds,
    });
  }, [
    agent,
    agentClient,
    canRun,
    effectiveModel,
    llmNodeId,
    nodeIds,
    prompt,
    startRun,
  ]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      {/* ── Top: prompt input + model + Run/Stop ──────────────────── */}
      <div className="flex shrink-0 flex-col gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Ask ${agent.id} something… (⌘/Ctrl+Enter)`}
          rows={3}
          className="font-mono text-xs"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
              e.preventDefault();
              dispatch();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            model
          </label>
          <div className="flex-1">
            <ModelMicroSwitcher
              value={effectiveModel}
              onChange={(v) => setEffectiveModel(v)}
              disablePortal
            />
          </div>
          {isRunning ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => stopRun(agent.id)}
              className="h-7 text-xs"
            >
              <Square className="mr-1 h-3 w-3" aria-hidden="true" />
              stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={dispatch}
              disabled={!canRun}
              className="h-7 text-xs"
              title="Cmd/Ctrl-Enter from the prompt"
            >
              <Play className="mr-1 h-3 w-3" aria-hidden="true" />
              run
            </Button>
          )}
          {display && !isRunning && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => clearRun(agent.id)}
              className="h-7 text-xs"
            >
              clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Bottom: store-driven output ───────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/30">
        {display ? (
          <RunOutput display={display} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <div>
              <p className="mb-1">No output yet.</p>
              <p className="text-xs">
                Type a prompt above and hit{" "}
                <span className="font-mono">run</span>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunOutput({
  display,
}: {
  display: NonNullable<ReturnType<typeof useEngineRunStore.getState>["runs"][string]>;
}) {
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
