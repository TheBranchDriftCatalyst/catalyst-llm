/**
 * Engine tab — viewport-bound, no-scroll layout.
 *
 *   ┌────────────┬──────────────────────────────────────────┐
 *   │            │  header (agent name + tools + reset)     │
 *   │  Agents    ├──────────────────────────────────────────┤
 *   │  picker    │                                          │
 *   │  (280px)   │   ReactFlow topology (fills h+w)         │
 *   │            │                                          │
 *   └────────────┴──────────────────────────────────────────┘
 *
 * A right-side `Sheet` overlay (Radix, from catalyst-ui) is wired in
 * but inert in T4' — T6 (runs-by-node) and T8 (PromptExplorerSheet)
 * fill its content and add the triggers that flip `sheetContext`.
 *
 * Config edits flow through useEngineStore (persisted to localStorage
 * under `catalyst-llm-sdk:engine:v2`); chatStore.sendMessage reads
 * the store on every chat dispatch and stuffs the overrides into the
 * wire request's `agent_config` field.
 *
 * Stacked NodeConfigCards (the interim from T2) are gone — T5' moves
 * every field onto the node cards themselves.
 */
import { useMemo, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thebranchdriftcatalyst/catalyst-ui/ui/sheet";
import { Activity, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import type { AgentDescriptor } from "../../agent/events.js";
import { useAgents } from "../../react/hooks.js";
import { useEngineStore } from "../../react/engineStore.js";
import { cn } from "../utils.js";
import { PromptExplorerSheet } from "../PromptExplorerSheet.js";
import { ReactFlowAgentTopology } from "./ReactFlowAgentTopology.js";

function countAgentOverrides(
  agentCfg: Record<string, Record<string, unknown>> | undefined,
): number {
  if (!agentCfg) return 0;
  let n = 0;
  for (const nodeCfg of Object.values(agentCfg)) {
    if (nodeCfg) n += Object.keys(nodeCfg).length;
  }
  return n;
}

/**
 * What the right-side Sheet should show. Lifted to EngineView so
 * triggers anywhere in the tree (a node's prompt icon, a node's
 * runs icon, etc.) can open the sheet by setting this state. T4'
 * defines the shape; T6/T8 fill in the union with real content
 * types.
 */
export type SheetContext =
  | { kind: "prompt"; agentId: string; nodeId: string }
  | { kind: "runs"; agentId: string; nodeId: string }
  | null;

export interface EngineViewProps {
  className?: string;
}

export function EngineView({ className }: EngineViewProps) {
  const { agents, loading, error, refresh } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    undefined,
  );
  const [sheetContext, setSheetContext] = useState<SheetContext>(null);

  const selected = useMemo(() => {
    if (!agents.length) return undefined;
    const found = agents.find((a) => a.id === selectedAgentId);
    return found ?? agents[0];
  }, [agents, selectedAgentId]);

  return (
    <div
      className={cn(
        "flex h-full w-full overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      {/* LEFT: agent picker. h-full + flex column + inner overflow-y-auto
       * keeps the whole pane scrollable only when there are more agents
       * than fit; the top of the picker is always pinned. */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Agents
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            title="Refresh /api/agents"
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          >
            Failed to load agents: {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && agents.length === 0 ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No agents registered. Configure VITE_AGENT_URL and start
              catalyst-langgraph.
            </div>
          ) : (
            agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                active={selected?.id === a.id}
                onClick={() => setSelectedAgentId(a.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* CENTER: agent header + reactflow canvas. flex-1 + min-h-0
       * lets the canvas claim every remaining pixel. Without min-h-0
       * the flex child would push past the viewport and reintroduce
       * page-level scrolling. */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {selected ? (
          <AgentDetail
            agent={selected}
            onOpenPromptSheet={(nodeId) =>
              setSheetContext({
                kind: "prompt",
                agentId: selected.id,
                nodeId,
              })
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an agent on the left to inspect it.
          </div>
        )}
      </main>

      {/* RIGHT: contextual Sheet. Inert in T4' — placeholder content
       * until T6 (runs) and T8 (prompt explorer) wire in real bodies +
       * triggers. */}
      <Sheet
        open={sheetContext !== null}
        onOpenChange={(open) => {
          if (!open) setSheetContext(null);
        }}
      >
        <SheetContent side="right" className="flex w-[400px] flex-col sm:w-[500px]">
          <SheetHeader>
            <SheetTitle>
              {sheetContext?.kind === "prompt"
                ? `Prompts for ${sheetContext.agentId}.${sheetContext.nodeId}`
                : "Runs"}
            </SheetTitle>
            <SheetDescription>
              {sheetContext?.kind === "prompt"
                ? "Bind a saved prompt, set an inline override, or edit the bound preset."
                : sheetContext
                  ? `${sheetContext.agentId}.${sheetContext.nodeId}`
                  : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {sheetContext?.kind === "prompt" && (
              <PromptExplorerSheet
                agentId={sheetContext.agentId}
                nodeId={sheetContext.nodeId}
                onClose={() => setSheetContext(null)}
              />
            )}
            {sheetContext?.kind === "runs" && (
              <div className="text-sm text-muted-foreground">
                Sheet body lands in llm-jui.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AgentCard({
  agent,
  active,
  onClick,
}: {
  agent: AgentDescriptor;
  active: boolean;
  onClick: () => void;
}) {
  const agentCfg = useEngineStore((s) => s.configs[agent.id]);
  const overrideCount = countAgentOverrides(agentCfg);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border bg-card/50 p-3 transition-colors",
        active
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border/60 hover:bg-card/80",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">{agent.id}</div>
        {overrideCount > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            {overrideCount} edited
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {agent.description}
      </p>
      {agent.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <Wrench className="h-2.5 w-2.5" aria-hidden="true" />
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function AgentDetail({
  agent,
  onOpenPromptSheet,
}: {
  agent: AgentDescriptor;
  onOpenPromptSheet: (nodeId: string) => void;
}) {
  const agentCfg = useEngineStore((s) => s.configs[agent.id]);
  const resetAgent = useEngineStore((s) => s.resetAgent);
  const editedCount = countAgentOverrides(agentCfg);

  // Node selection drives the topology's visual highlight only in
  // T4'. T5' adds inline-on-node config so selection becomes more
  // meaningful; T6/T8 add per-node triggers that open the sheet via
  // onOpenSheet.
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    undefined,
  );

  return (
    <>
      {/* Tight header strip — shrink-0 so the topology canvas below
       * gets every leftover pixel. */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-6 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="truncate">{agent.id}</span>
          </h1>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {agent.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {agent.tools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                >
                  <Wrench className="h-3 w-3" aria-hidden="true" />
                  {t}
                </span>
              ))}
            </div>
          )}
          {editedCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetAgent(agent.id)}
              title="Clear all overrides for this Agent"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Reset all
            </Button>
          )}
        </div>
      </header>

      {/* Canvas fills the rest of the viewport. min-h-0 is the
       * load-bearing CSS — without it the flex child would refuse
       * to shrink below its intrinsic height and the page would
       * re-introduce scrolling. */}
      <div className="min-h-0 flex-1">
        <ReactFlowAgentTopology
          topology={agent.topology}
          agentId={agent.id}
          agentTools={agent.tools}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
          onOpenPromptSheet={onOpenPromptSheet}
          // Override the rounded card framing — at viewport scale
          // the inner border becomes redundant with the header
          // divider above and the page chrome around it.
          className="rounded-none border-0"
        />
      </div>
    </>
  );
}
