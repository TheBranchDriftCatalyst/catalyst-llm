/**
 * Interactive topology renderer — replaces the static dagre+divs
 * AgentTopologyView with a reactflow canvas of custom node cards.
 *
 * Layout: dagre still computes the initial positions (visual
 * continuity with the old view + per-node-type sizing). Positions
 * are handed to reactflow as static `position` values; we disable
 * dragging because the layout is meant to mirror the LangGraph
 * topology, not be operator-rearranged. Pan + zoom stay on so big
 * graphs scroll naturally.
 *
 * Custom node components:
 *   - StartEndChip   — tight pill for __start__ / __end__ terminals
 *   - ToolsNodeCard  — medium card with a tool-count badge
 *   - AgentNodeCard  — large card with ModelMicroSwitcher + a row of
 *                      param chips, sourced live from useEngineStore
 *
 * Selection is owned by the parent (EngineView): `selectedNodeId`
 * comes in as a prop; we render the visual highlight inside each
 * node card. Click bubbles up via `onNodeSelect(nodeId)`; clicking
 * the empty pane fires `onNodeSelect(undefined)` to deselect.
 *
 * The right-panel Config tab (T5, llm-mel) edits the FULL per-node
 * schema. This file only embeds the most-used knobs (model, temp,
 * max_tokens) inline so the operator gets a glanceable feel for
 * each node without opening the panel.
 */
import { useMemo, useCallback } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Activity, CircleDot, Flag, Wrench } from "lucide-react";
import type {
  AgentConfigSchema,
  AgentTopology,
  AgentTopologyNode,
} from "../../agent/events.js";
import { ModelMicroSwitcher } from "../ModelMicroSwitcher.js";
import { useEngineStore } from "../../react/engineStore.js";
import { cn } from "../utils.js";

export interface ReactFlowAgentTopologyProps {
  topology: AgentTopology;
  /** Used by node cards to read live overrides from useEngineStore. */
  agentId: string;
  /** Tools registered with the Agent (from AgentDescriptor.tools).
   * Rendered as chips inside tools nodes whose id matches one of these,
   * or in the generic "tools" dispatcher when there's no match. */
  agentTools?: string[];
  /** Node id to render selected; `undefined` = nothing selected. */
  selectedNodeId?: string;
  /** Fires on node click (with node id) AND on pane click (with `undefined`). */
  onNodeSelect?: (nodeId: string | undefined) => void;
  className?: string;
}

// Per-type sizing fed into dagre so the layout respects each card's
// actual footprint. Card components below use matching style widths.
// Sizes are deliberately generous — embedded selectors + tool chip
// rows need room to breathe; cramped cards force ellipsis on model
// ids and make the popover positioning ugly.
const NODE_SIZES: Record<AgentTopologyNode["type"], { w: number; h: number }> =
  {
    start: { w: 140, h: 44 },
    end: { w: 140, h: 44 },
    tools: { w: 220, h: 96 },
    agent: { w: 280, h: 140 },
  };

const RANK_SEP = 80;
const NODE_SEP = 90;

// Per-type icon + visual tone. Tones colour the card border + a faint
// background tint; the existing dagre view used the same palette so
// the swap is visually continuous.
const NODE_VISUAL: Record<
  AgentTopologyNode["type"],
  { icon: typeof Activity; label: string; tone: string }
> = {
  start: {
    icon: Flag,
    label: "start",
    tone: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  },
  end: {
    icon: CircleDot,
    label: "end",
    tone: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  },
  agent: {
    icon: Activity,
    label: "agent",
    tone: "border-primary/50 bg-primary/10 text-primary",
  },
  tools: {
    icon: Wrench,
    label: "tools",
    tone: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  },
};

// What goes into each reactflow node's .data — custom components below
// read this. selectedNodeId lives here so the highlight ring re-renders
// when selection changes (passing as data is the simplest path; for 5-
// 10 nodes per agent the re-render cost is irrelevant).
interface CommonNodeData extends Record<string, unknown> {
  agentId: string;
  nodeId: string;
  type: AgentTopologyNode["type"];
  schema: AgentConfigSchema | null;
  defaults: Record<string, unknown> | null;
  selectedNodeId: string | undefined;
  /** Tools to render on `tools` nodes. Other node types ignore. */
  toolList: string[];
}

function layoutWithDagre(
  topology: AgentTopology,
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of topology.nodes) {
    const size = NODE_SIZES[n.type];
    g.setNode(n.id, { width: size.w, height: size.h });
  }
  for (const e of topology.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const out: Record<string, { x: number; y: number }> = {};
  for (const n of topology.nodes) {
    const d = g.node(n.id) as { x: number; y: number };
    const size = NODE_SIZES[n.type];
    // dagre reports centre points; reactflow uses top-left corners.
    out[n.id] = { x: d.x - size.w / 2, y: d.y - size.h / 2 };
  }
  return out;
}

// ─── Custom node components ──────────────────────────────────────────

function StartEndChip({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL[d.type];
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  return (
    <div
      className={cn(
        "flex h-[44px] w-[140px] items-center gap-2 rounded-full border-2 px-4 text-sm font-mono shadow-sm transition-all",
        visual.tone,
        selected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
      )}
      title={`${visual.label}: ${d.nodeId}`}
    >
      {/* Terminals only need one handle each. Reactflow renders nothing
       * visual at the handle position by default; they're just edge
       * anchors. */}
      {d.type !== "start" && <Handle type="target" position={Position.Top} />}
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{d.nodeId}</span>
      {d.type !== "end" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

function ToolsNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.tools;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  // If the node's id matches one of the agent's registered tools, this
  // node IS that specific tool (e.g. research.web_search) — show just
  // that one chip. Otherwise it's the generic dispatcher (main.tools)
  // and we list every tool the agent advertises.
  const matchedTool = d.toolList.includes(d.nodeId) ? [d.nodeId] : null;
  const chips = matchedTool ?? d.toolList;
  return (
    <div
      className={cn(
        "flex h-[96px] w-[220px] flex-col gap-1.5 rounded-md border-2 p-2 shadow-sm transition-all",
        visual.tone,
        selected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
      )}
      title={`tools dispatcher: ${d.nodeId}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">{d.nodeId}</span>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 overflow-hidden text-[10px]">
          {chips.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 font-mono text-amber-200"
            >
              {t}
            </span>
          ))}
          {chips.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{chips.length - 4}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          no tools bound
        </span>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function AgentNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.agent;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;

  // Live model + temp from engineStore, falling back to defaults
  // advertised by the schema. The selector at the bottom of the
  // (right) Config tab in T5 is the canonical edit surface; this
  // inline switcher is a shortcut for the most-tweaked knob.
  const liveModel = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.nodeId]?.model as string | undefined,
  );
  const liveTemp = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.nodeId]?.temperature as number | undefined,
  );
  const liveMaxTokens = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.nodeId]?.max_tokens as number | undefined,
  );
  const setField = useEngineStore((s) => s.setField);

  const schemaProps = d.schema?.properties ?? {};
  const hasModel = "model" in schemaProps;
  const hasTemp = "temperature" in schemaProps;
  const hasMaxTokens = "max_tokens" in schemaProps;

  const effectiveModel =
    liveModel ?? ((d.defaults?.model as string | undefined) || "");
  const effectiveTemp =
    liveTemp ?? (d.defaults?.temperature as number | undefined);
  const effectiveMaxTokens =
    liveMaxTokens ?? (d.defaults?.max_tokens as number | undefined);

  return (
    <div
      className={cn(
        "flex h-[140px] w-[280px] flex-col gap-2 rounded-md border-2 p-3 shadow-sm transition-all",
        visual.tone,
        selected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
      )}
      title={`agent node: ${d.nodeId}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">{d.nodeId}</span>
      </div>

      {/* Model switcher — the .nodrag/.nopan/.nowheel hooks stop
       * reactflow's pan handler from eating clicks on the trigger
       * button. The popover itself is portalled to document.body
       * (ModelMicroSwitcher uses createPortal) so it escapes
       * reactflow's per-node stacking context. */}
      {hasModel && (
        <div className="nodrag nopan nowheel">
          <ModelMicroSwitcher
            value={effectiveModel}
            onChange={(v) => setField(d.agentId, d.nodeId, "model", v)}
            className="w-full"
          />
        </div>
      )}

      {(hasTemp || hasMaxTokens) && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {hasTemp && (
            <span className="rounded-sm border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono">
              t: {effectiveTemp?.toFixed(2) ?? "—"}
            </span>
          )}
          {hasMaxTokens && (
            <span className="rounded-sm border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono">
              max: {effectiveMaxTokens ?? "—"}
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = {
  start: StartEndChip,
  end: StartEndChip,
  tools: ToolsNodeCard,
  agent: AgentNodeCard,
};

// Edge colors. The catalyst theme stores --accent / --foreground as
// full color values (#hex or hsl(...)), NOT as bare HSL triples — so
// `hsl(var(--accent))` would expand to e.g. `hsl(#some-hex)` which
// is invalid CSS and reactflow drops the stroke entirely (edges go
// invisible). We use the bare custom-property reference instead;
// browsers resolve it to whatever the active theme defines.
const EDGE_SOLID = "var(--foreground)";
const EDGE_CONDITIONAL = "var(--accent)";

export function ReactFlowAgentTopology({
  topology,
  agentId,
  agentTools = [],
  selectedNodeId,
  onNodeSelect,
  className,
}: ReactFlowAgentTopologyProps) {
  const positions = useMemo(() => layoutWithDagre(topology), [topology]);

  const nodes: Node[] = useMemo(
    () =>
      topology.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: {
          agentId,
          nodeId: n.id,
          type: n.type,
          schema: n.config_schema,
          defaults: n.config_defaults,
          selectedNodeId,
          toolList: agentTools,
        } satisfies CommonNodeData,
        draggable: false,
        selectable: true,
      })),
    [topology.nodes, positions, agentId, selectedNodeId, agentTools],
  );

  const edges: Edge[] = useMemo(
    () =>
      topology.edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        animated: false,
        // Conditional router edges = dashed accent; solid edges =
        // bright foreground. Stroke 2.5 keeps edges readable against
        // the dark canvas + Background dot grid.
        style: e.conditional
          ? {
              stroke: EDGE_CONDITIONAL,
              strokeDasharray: "6 4",
              strokeWidth: 2.5,
              strokeOpacity: 0.9,
            }
          : { stroke: EDGE_SOLID, strokeWidth: 2.5, strokeOpacity: 0.65 },
        markerEnd: {
          type: "arrowclosed" as const,
          width: 18,
          height: 18,
          color: e.conditional ? EDGE_CONDITIONAL : EDGE_SOLID,
        },
      })),
    [topology.edges],
  );

  const handleNodeClick = useCallback(
    (_e: unknown, node: Node) => {
      onNodeSelect?.(node.id);
    },
    [onNodeSelect],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(undefined);
  }, [onNodeSelect]);

  return (
    <div
      className={cn(
        "h-[520px] w-full rounded-lg border border-border/60 bg-card/30 overflow-hidden",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        proOptions={{ hideAttribution: true }}
        panOnDrag
        zoomOnScroll
      >
        <Background gap={20} className="opacity-40" />
        <Controls
          showInteractive={false}
          className="!bg-card/80 !border-border/60"
        />
      </ReactFlow>
    </div>
  );
}
