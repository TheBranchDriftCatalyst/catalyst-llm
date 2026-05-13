/**
 * Engine tab — composed locally from SDK primitives.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ┌── left ─────┐ ┌── center ────────────────┐ ┌── right ───┐ │
 *   │ │ Agents item │ │ agent header + topology  │ │ Test run    │ │
 *   │ │ Events item │ │ canvas                    │ │ Node detail │ │
 *   │ └─────────────┘ └───────────────────────────┘ └─────────────┘ │
 *   │ ┌── bottom ────────────────────────────────────────────────┐  │
 *   │ │ Terminal item (live tokens + reasoning)                 │  │
 *   │ └──────────────────────────────────────────────────────────┘  │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Page composition lives in the playground (per the SDK's "primitives
 * not pages" policy); the SDK ships the rail panels + topology
 * renderer + page-shell primitives. Prompt explorer + runs list stay
 * as right-edge Sheet overlays — transient workbench surfaces, not
 * persistent operator state.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thebranchdriftcatalyst/catalyst-ui/ui/sheet";
import { Activity, Cpu, RotateCcw } from "lucide-react";
import {
  AgentsListPanel,
  EventsPanel,
  NodeDetailPanel,
  NodeRunsList,
  PageShell,
  PromptExplorerSheet,
  ReactFlowAgentTopology,
  SidePanel,
  TerminalPanel,
  TestRunPanel,
  useAgents,
  useEngineRunStore,
  useEngineStore,
  useItemRails,
  type AgentDescriptor,
  type RailMap,
} from "@catalyst/llm-sdk";
import type { PageMeta } from "./types.js";

/** Default rail assignments for Engine SidePanelItems. Operator drag
 * + drop persists overrides to localStorage. */
const ENGINE_DEFAULT_RAILS: RailMap = {
  left: ["engine.agents", "engine.events"],
  right: ["engine.test-run", "engine.node-detail"],
  bottom: ["engine.terminal"],
};

type SheetContext =
  | { kind: "prompt"; agentId: string; nodeId: string }
  | { kind: "runs"; agentId: string; nodeId: string }
  | null;

export function EnginePage() {
  const { agents, loading, error, refresh } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    undefined,
  );
  const [sheetContext, setSheetContext] = useState<SheetContext>(null);
  // Counter bumped on __start__ click to force the Test run rail
  // item open; see SidePanelItem `openSignal`.
  const [testRunOpenSignal, setTestRunOpenSignal] = useState(0);

  const selected = useMemo(() => {
    if (!agents.length) return undefined;
    const found = agents.find((a) => a.id === selectedAgentId);
    return found ?? agents[0];
  }, [agents, selectedAgentId]);

  const activeNodeId = useEngineRunStore((s) =>
    selected ? s.runs[selected.id]?.activeNodeId : undefined,
  );

  const panelEvents = useEngineRunStore(
    (s) =>
      (selected ? s.runs[selected.id]?.panelEvents : undefined) ??
      EMPTY_PANEL_EVENTS,
  );

  const { rails, moveItem } = useItemRails("engine", ENGINE_DEFAULT_RAILS);

  const renderItemById = (id: string): ReactNode => {
    switch (id) {
      case "engine.agents":
        return (
          <AgentsListPanel
            agents={agents}
            loading={loading}
            error={error}
            selectedId={selected?.id}
            onSelect={setSelectedAgentId}
            onRefresh={() => void refresh()}
          />
        );
      case "engine.events":
        return (
          <EventsPanel
            eventCount={panelEvents.length}
            selectedAgentId={selected?.id}
          />
        );
      case "engine.test-run":
        return (
          <TestRunPanel agent={selected} openSignal={testRunOpenSignal} />
        );
      case "engine.node-detail":
        return <NodeDetailPanel />;
      case "engine.terminal":
        return <TerminalPanel eventCount={panelEvents.length} />;
      default:
        return null;
    }
  };

  const renderRail = (side: "left" | "right" | "bottom"): ReactNode => (
    <SidePanel side={side} onItemMove={moveItem}>
      {rails[side].map((id) => (
        <Fragment key={id}>{renderItemById(id)}</Fragment>
      ))}
    </SidePanel>
  );

  return (
    <main
      id="main-content"
      className="relative h-full w-full flex-1 overflow-hidden bg-background text-foreground"
    >
      <PageShell
        storageNamespace="engine"
        left={renderRail("left")}
        right={renderRail("right")}
        bottom={renderRail("bottom")}
      >
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
            onOpenRunsSheet={(nodeId) =>
              setSheetContext({
                kind: "runs",
                agentId: selected.id,
                nodeId,
              })
            }
            onStartTestRun={() => setTestRunOpenSignal((n) => n + 1)}
            activeNodeId={activeNodeId}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an agent on the left to inspect it.
          </div>
        )}
      </PageShell>

      <Sheet
        open={sheetContext !== null}
        onOpenChange={(open) => {
          if (!open) setSheetContext(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-[50vw] min-w-[640px] max-w-[960px] flex-col"
        >
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
              <NodeRunsList
                agentId={sheetContext.agentId}
                nodeId={sheetContext.nodeId}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

// Stable empty array for the panelEvents selector — returning a fresh
// [] each render would trigger React's getSnapshot warning + an
// infinite re-render loop.
const EMPTY_PANEL_EVENTS: never[] = Object.freeze([]) as never[];

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

function AgentDetail({
  agent,
  onOpenPromptSheet,
  onOpenRunsSheet,
  onStartTestRun,
  activeNodeId,
}: {
  agent: AgentDescriptor;
  onOpenPromptSheet: (nodeId: string) => void;
  onOpenRunsSheet: (nodeId: string) => void;
  onStartTestRun: () => void;
  activeNodeId: string | undefined;
}) {
  const agentCfg = useEngineStore((s) => s.configs[agent.id]);
  const resetAgent = useEngineStore((s) => s.resetAgent);
  const editedCount = countAgentOverrides(agentCfg);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    undefined,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="truncate">{agent.id}</span>
          </h1>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {agent.description}
          </p>
        </div>
        {editedCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => resetAgent(agent.id)}
            title="Clear all overrides for this Agent"
            className="shrink-0"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Reset all
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <ReactFlowAgentTopology
          topology={agent.topology}
          agentId={agent.id}
          agentTools={agent.tools}
          selectedNodeId={selectedNodeId}
          activeNodeId={activeNodeId}
          onNodeSelect={setSelectedNodeId}
          onOpenPromptSheet={onOpenPromptSheet}
          onOpenRunsSheet={onOpenRunsSheet}
          onStartTestRun={onStartTestRun}
          className="rounded-none border-0"
        />
      </div>
    </div>
  );
}

export const enginePageMeta: PageMeta = {
  id: "engine",
  label: "Engine",
  icon: Cpu,
  path: "/engine",
  component: EnginePage,
};
