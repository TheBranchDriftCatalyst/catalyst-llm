/**
 * Engine tab — composed from the PageShell primitive.
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
 * Replaces the previous two-stacked-left-sidebars layout (one for
 * agents inside EngineView, one for events inside LangGraphEnginePanel)
 * with a single unified left rail that stacks both as collapsible
 * SidePanelItems. Right + bottom rails are first-class citizens of
 * the same PageShell.
 *
 * Test run lives inline in the right rail — clicking the __start__
 * chip pops the rail item open and focuses the prompt textarea. Prompt
 * explorer + runs list stay as right-edge Sheet overlays because
 * they're transient workbench surfaces, not persistent operator state.
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
import {
  Activity,
  Bot,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Terminal as TerminalIcon,
  Wrench,
} from "lucide-react";
import type { AgentDescriptor } from "../../agent/events.js";
import { useAgents } from "../../react/hooks.js";
import { useEngineStore } from "../../react/engineStore.js";
import { cn } from "../utils.js";
import { PromptExplorerSheet } from "../PromptExplorerSheet.js";
import { NodeRunsList } from "./NodeRunsList.js";
import { ReactFlowAgentTopology } from "./ReactFlowAgentTopology.js";
import { TestRunSheet } from "./TestRunSheet.js";
import { useEngineRunStore } from "../../react/engineRunStore.js";
import { PageShell } from "../page-shell/PageShell.js";
import { SidePanel } from "../page-shell/SidePanel.js";
import { SidePanelItem } from "../page-shell/SidePanelItem.js";
import {
  useItemRails,
  type RailMap,
} from "../page-shell/useItemRails.js";

/** Default rail assignments for Engine SidePanelItems. The operator
 * can re-arrange them at runtime via drag-and-drop; assignments
 * persist to localStorage. Adding a new id here makes it appear in
 * the named rail on first visit; the persistence layer preserves any
 * existing customisations. */
const ENGINE_DEFAULT_RAILS: RailMap = {
  left: ["engine.agents", "engine.events"],
  right: ["engine.test-run", "engine.node-detail"],
  bottom: ["engine.terminal"],
};

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

/** SidePanel-item-ready shape for the Engine page's Sheet branches.
 * Test-run is no longer a Sheet branch — it lives in the right rail. */
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
  // Counter that bumps every time __start__ is clicked, forcing the
  // Test run rail item open on the right. The item also stays open
  // across runs once the operator has it expanded — see the
  // `openSignal` prop on SidePanelItem.
  const [testRunOpenSignal, setTestRunOpenSignal] = useState(0);

  const selected = useMemo(() => {
    if (!agents.length) return undefined;
    const found = agents.find((a) => a.id === selectedAgentId);
    return found ?? agents[0];
  }, [agents, selectedAgentId]);

  // Live "executing now" node id for the currently selected agent,
  // sourced from useEngineRunStore so the topology highlight survives
  // sheet unmounts. See engineRunStore for the lifecycle.
  const activeNodeId = useEngineRunStore((s) =>
    selected ? s.runs[selected.id]?.activeNodeId : undefined,
  );

  // Live event log — drives the EventStream + Terminal panels.
  const panelEvents = useEngineRunStore(
    (s) => (selected ? s.runs[selected.id]?.panelEvents : undefined) ?? EMPTY_PANEL_EVENTS,
  );

  // Rail assignments — operator can drag SidePanelItems between rails
  // and the assignments persist to localStorage.
  const { rails, moveItem } = useItemRails("engine", ENGINE_DEFAULT_RAILS);

  // Each rail item rendered by id so the rail loop below can stamp
  // them in whatever order the assignment hook returned. Doing it as
  // a switch keeps the JSX inline + closures over local state simple.
  const renderItemById = (id: string): ReactNode => {
    switch (id) {
      case "engine.agents":
        return (
          <SidePanelItem
            id="engine.agents"
            title="Agents"
            icon={<Bot className="h-3 w-3" />}
            headerRight={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void refresh();
                }}
                title="Refresh /api/agents"
                className="h-5 w-5 p-0"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              </Button>
            }
          >
            <div className="space-y-1 p-1">
              {error && (
                <div
                  role="alert"
                  className="rounded border border-destructive/30 bg-destructive/10 p-1.5 text-xs text-destructive"
                >
                  Failed to load agents: {error}
                </div>
              )}
              {loading && agents.length === 0 ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : agents.length === 0 ? (
                <div className="text-xs text-muted-foreground">
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
          </SidePanelItem>
        );
      case "engine.events":
        return (
          <SidePanelItem
            id="engine.events"
            title="Events"
            icon={<Layers className="h-3 w-3" />}
            defaultCollapsed
            headerRight={
              <span className="text-[10px] text-muted-foreground">
                {panelEvents.length}
              </span>
            }
          >
            <div className="p-1.5 text-[11px] text-muted-foreground">
              <p>
                EventStream — chronological + filterable. Sub-component
                lands next.
              </p>
              <p className="mt-1 italic">
                {panelEvents.length} buffered events for{" "}
                <span className="font-mono">{selected?.id ?? "—"}</span>
              </p>
            </div>
          </SidePanelItem>
        );
      case "engine.test-run":
        return (
          <SidePanelItem
            id="engine.test-run"
            title="Test run"
            icon={<Play className="h-3 w-3" />}
            openSignal={testRunOpenSignal}
            headerRight={
              selected ? (
                <span className="font-mono text-[10px] normal-case tracking-normal text-foreground">
                  {selected.id}
                </span>
              ) : undefined
            }
          >
            {selected ? (
              <div className="flex h-full min-h-0 flex-col p-1.5">
                <TestRunSheet agent={selected} />
              </div>
            ) : (
              <div className="p-1.5 text-[11px] text-muted-foreground">
                Select an agent to dispatch a test run.
              </div>
            )}
          </SidePanelItem>
        );
      case "engine.node-detail":
        return (
          <SidePanelItem
            id="engine.node-detail"
            title="Node detail"
            icon={<Activity className="h-3 w-3" />}
            defaultCollapsed
          >
            <div className="p-1.5 text-[11px] text-muted-foreground">
              NodePanel — click a topology node to inspect its last
              events + drill into payload. Lands next.
            </div>
          </SidePanelItem>
        );
      case "engine.terminal":
        return (
          <SidePanelItem
            id="engine.terminal"
            title="Terminal"
            icon={<TerminalIcon className="h-3 w-3" />}
            headerRight={
              <span className="text-[10px] text-muted-foreground">
                {panelEvents.length} total
              </span>
            }
          >
            <div className="p-1.5 font-mono text-[11px] text-muted-foreground">
              Terminal — live token stream + reasoning. Lands next.
            </div>
          </SidePanelItem>
        );
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
    <div
      className={cn("relative h-full w-full overflow-hidden bg-background text-foreground", className)}
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

      {/* RIGHT-edge Sheet overlay — transient workbench surfaces for
       * prompt explorer + runs list. Test-run is NOT here anymore; it
       * lives in the right SidePanel rail above. */}
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
    </div>
  );
}

// Stable empty array for the panelEvents selector — returning a fresh
// [] each render would trigger React's getSnapshot warning + an
// infinite re-render loop.
const EMPTY_PANEL_EVENTS: never[] = Object.freeze([]) as never[];

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
        "w-full text-left rounded-md border bg-card/50 p-1.5 transition-colors",
        active
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border/60 hover:bg-card/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-medium text-sm">{agent.id}</div>
        {overrideCount > 0 && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            {overrideCount}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
        {agent.description}
      </p>
      {agent.tools.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground"
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
