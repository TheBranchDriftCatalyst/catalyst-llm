/**
 * LangGraphEnginePanel — a reusable forensic workbench for any
 * LangGraph annotated with an AgentDescriptor.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ┌─Splitter (Splitter)─┐ ┌─Splitter─┐                          │
 *   │ │EventStream│TIMELINE+SCRUB        │NodePanel│                │
 *   │ │ (left)    │──────────────────────│ (right) │                │
 *   │ │           │ ReactFlowAgent       │         │                │
 *   │ │           │   Topology (center)  │         │                │
 *   │ └───────────┴──────────────────────┴─────────┘                │
 *   │ ┌─Splitter (horizontal)─────────────────────┐                  │
 *   │ │ Terminal (live tokens + reasoning + log) │                  │
 *   │ └──────────────────────────────────────────┘                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Ported from /Users/panda/catalyst-devspace/workspace/langgraph-dev/
 * web/src/components/shell/EngineTab.tsx, but the center pane uses
 * our existing ReactFlowAgentTopology (the user prefers its
 * config-componentized node cards + agnostic AgentTopology backend
 * integration). The other panes (EventStream / RunTimeline +
 * ScrubControl / NodePanel / Terminal) land in subsequent commits
 * (Phase 3a-d of the rollout plan) — Phase 2 ships placeholder
 * stubs so the layout shell is visible immediately.
 *
 * The component is generic — it takes (agent, events, scrubT) and
 * renders. Consumers (catalyst-llm playground, or any future app)
 * wire it to their event source.
 */
import { useMemo, useState } from "react";
import type { AgentDescriptor } from "../../agent/events.js";
import { ReactFlowAgentTopology } from "../engine/ReactFlowAgentTopology.js";
import { Splitter } from "./Splitter.js";
import type { PanelEvent, PanelSelection } from "./types.js";
import "./styles.css";

export interface LangGraphEnginePanelProps {
  /** The agent whose topology we render in the center pane. */
  agent: AgentDescriptor;
  /** Live + historical event log (caller-managed; usually fed from
   * useRunTraceStore or hydrated from /api/runs/{run_id}). */
  events: PanelEvent[];
  /** When set, downstream panes filter to events with ts ≤ scrubT.
   * Phase 3b's ScrubControl writes this; Phase 2 leaves it static null. */
  scrubT?: number | null;
  /** The active node id currently executing — drives the topology's
   * pulsing ring (already supported by ReactFlowAgentTopology). */
  activeNodeId?: string;
  /** Per-node operator config: the agent-id + node-id-keyed engineStore
   * configs flow through. Caller already wires the per-field state via
   * useEngineStore.setField, so this prop is mostly for the inline
   * node-controls visualisation that ReactFlowAgentTopology owns. */
  className?: string;
  /** Override the dispatch trigger — when the operator clicks __start__,
   * we forward this. Optional; consumer can also wire a top input bar. */
  onStartTestRun?: () => void;
  /** Override the prompt sheet trigger — when the operator clicks a
   * node's prompt icon. */
  onOpenPromptSheet?: (nodeId: string) => void;
  /** Override the runs sheet trigger — when the operator clicks a
   * node's runs icon. */
  onOpenRunsSheet?: (nodeId: string) => void;
}

export function LangGraphEnginePanel({
  agent,
  events,
  scrubT = null,
  activeNodeId,
  className,
  onStartTestRun,
  onOpenPromptSheet,
  onOpenRunsSheet,
}: LangGraphEnginePanelProps) {
  // Per-node selection lives here; sub-panes (NodePanel especially) read
  // it. ReactFlowAgentTopology has its own selectedNodeId concept which
  // mirrors this so the active highlight on the canvas matches the
  // right-pane drill-down target.
  const [selection, setSelection] = useState<PanelSelection | null>(null);

  // Phase 2 stubs use the visible event count as a smoke-test that the
  // panel is actually receiving the live stream. Phase 3a swaps these
  // for the real sub-component renderers.
  const visibleEvents = useMemo(() => {
    if (scrubT == null) return events;
    return events.filter((e) => e.ts <= scrubT);
  }, [events, scrubT]);

  return (
    <div
      className={`lg-engine-shell ${className ?? ""}`}
      data-agent-id={agent.id}
    >
      <div className="lg-engine-inner">
        <div className="lg-engine-grid">
          {/* ── Splitters write CSS vars consumed by .lg-engine-grid ── */}
          <Splitter
            orientation="vertical"
            cssVar="--lg-engine-col-left"
            storageKey="catalyst-llm-sdk:engine-panel:col-left"
            defaultPx={280}
            minPx={200}
            maxPx={560}
            style={{ gridColumn: 2, gridRow: 1 }}
          />
          <Splitter
            orientation="vertical"
            cssVar="--lg-engine-col-right"
            storageKey="catalyst-llm-sdk:engine-panel:col-right"
            defaultPx={360}
            minPx={240}
            maxPx={640}
            invert
            style={{ gridColumn: 4, gridRow: 1 }}
          />
          <Splitter
            orientation="horizontal"
            cssVar="--lg-engine-row-bottom"
            storageKey="catalyst-llm-sdk:engine-panel:row-bottom"
            defaultPx={220}
            minPx={120}
            maxPx={560}
            invert
            style={{ gridColumn: "1 / -1", gridRow: 2 }}
          />

          {/* ── LEFT: EventStream ─────────────────────────────────── */}
          <aside className="lg-engine-left border-r border-border bg-card/30 p-3">
            <PanePlaceholder
              title="events"
              detail={`${visibleEvents.length} buffered · sub-component lands next`}
              hint="EventStream — chronological + filterable"
            />
          </aside>

          {/* ── CENTER: RunTimeline + ScrubControl on top, our
               ReactFlowAgentTopology on bottom ────────────────── */}
          <main className="lg-engine-main">
            <div className="lg-engine-main-split">
              <div className="lg-engine-main-top border-b border-border bg-card/20 p-2">
                <PanePlaceholder
                  title="timeline"
                  detail={
                    scrubT != null
                      ? `scrubbed to ts ${Math.round(scrubT)}`
                      : "live"
                  }
                  hint="RunTimeline + ScrubControl — lands next"
                />
              </div>
              <Splitter
                orientation="horizontal"
                cssVar="--lg-engine-main-split"
                storageKey="catalyst-llm-sdk:engine-panel:main-split"
                defaultPx={220}
                minPx={120}
                maxPx={600}
              />
              <div className="lg-engine-main-bot">
                <ReactFlowAgentTopology
                  topology={agent.topology}
                  agentId={agent.id}
                  agentTools={agent.tools}
                  selectedNodeId={selection?.nodeId}
                  activeNodeId={activeNodeId}
                  onNodeSelect={(nodeId) =>
                    setSelection(
                      nodeId ? { nodeId, ownerToolId: null } : null,
                    )
                  }
                  onStartTestRun={onStartTestRun}
                  onOpenPromptSheet={onOpenPromptSheet}
                  onOpenRunsSheet={onOpenRunsSheet}
                  className="rounded-none border-0"
                />
              </div>
            </div>
          </main>

          {/* ── RIGHT: NodePanel ──────────────────────────────────── */}
          <aside className="lg-engine-right border-l border-border bg-card/30 p-3">
            <PanePlaceholder
              title={
                selection
                  ? `node: ${selection.nodeId}`
                  : "node detail"
              }
              detail={
                selection
                  ? "click any topology node to inspect it"
                  : "no node selected"
              }
              hint="NodePanel — lands next"
            />
          </aside>

          {/* ── BOTTOM: Terminal ──────────────────────────────────── */}
          <footer className="lg-engine-bottom border-t border-border bg-card/40">
            <PanePlaceholder
              title="terminal"
              detail={`${events.length} total events · ${visibleEvents.length} visible`}
              hint="Terminal — live token stream + reasoning, lands next"
            />
          </footer>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual stub for panes that haven't been ported yet. Tells the operator
 * the panel layout works AND that the sub-component is on the way.
 * Removed once Phase 3 ports land.
 */
function PanePlaceholder({
  title,
  detail,
  hint,
}: {
  title: string;
  detail: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col gap-1 text-xs">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="text-foreground">{detail}</div>
      <div className="mt-auto text-[10px] italic text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}
