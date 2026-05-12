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
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
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
import { useEngineStore } from "../../react/engineStore.js";
import { cn } from "../utils.js";
import { NodeInlineConfig } from "./NodeInlineConfig.js";

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
  /** Called when a node's prompt-icon button is clicked. Lets the
   * EngineView open the contextual Sheet scoped to that node. */
  onOpenPromptSheet?: (nodeId: string) => void;
  className?: string;
}

// Sizing for the fixed-shape node types (start/end/tools). Agent nodes
// size themselves from their schema field count — see
// computeAgentNodeSize() below.
const FIXED_NODE_SIZES: Record<"start" | "end" | "tools", { w: number; h: number }> = {
  start: { w: 140, h: 44 },
  end: { w: 140, h: 44 },
  tools: { w: 220, h: 96 },
};
const AGENT_NODE_WIDTH = 300;
const AGENT_HEADER_PX = 30;       // icon + nodeId row
const AGENT_ROW_PX = 28;          // one schema field, inline control
const AGENT_VERTICAL_PADDING = 24; // top + bottom card padding
const AGENT_MIN_HEIGHT = 80;
const AGENT_MAX_HEIGHT = 360;

function computeAgentNodeSize(
  schema: AgentConfigSchema | null,
): { w: number; h: number } {
  if (!schema?.properties) {
    return { w: AGENT_NODE_WIDTH, h: AGENT_MIN_HEIGHT };
  }
  const fieldCount = Object.keys(schema.properties).length;
  const h = Math.min(
    Math.max(
      AGENT_MIN_HEIGHT,
      AGENT_HEADER_PX + fieldCount * AGENT_ROW_PX + AGENT_VERTICAL_PADDING,
    ),
    AGENT_MAX_HEIGHT,
  );
  return { w: AGENT_NODE_WIDTH, h };
}

function getNodeSize(node: AgentTopologyNode): { w: number; h: number } {
  if (node.type === "agent") return computeAgentNodeSize(node.config_schema);
  return FIXED_NODE_SIZES[node.type];
}

const RANK_SEP = 60;
const NODE_SEP = 80;

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
  /** Computed pixel size — also fed to dagre. Cards style themselves
   * with these explicit width/height values to match. */
  size: { w: number; h: number };
  /** Tools to render on `tools` nodes. Other node types ignore. */
  toolList: string[];
  /** Called when the prompt-icon button on an agent node is clicked. */
  onOpenPromptSheet?: (nodeId: string) => void;
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
    const size = getNodeSize(n);
    g.setNode(n.id, { width: size.w, height: size.h });
  }
  for (const e of topology.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const out: Record<string, { x: number; y: number }> = {};
  for (const n of topology.nodes) {
    const d = g.node(n.id) as { x: number; y: number };
    const size = getNodeSize(n);
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

  // Subscribe to the whole per-node override dict so any field edit
  // re-renders this card (and the NodeInlineConfig inside it reads
  // the same dict for both value-merge and override-key membership).
  // EMPTY_OBJ keeps reference identity stable when nothing's set.
  const nodeOverrides = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.nodeId],
  );
  const overrides = nodeOverrides ?? EMPTY_OBJ;
  const setField = useEngineStore((s) => s.setField);

  if (!d.schema) {
    return (
      <div
        className={cn(
          "flex flex-col gap-1 rounded-md border-2 p-2 shadow-sm transition-all",
          visual.tone,
          selected &&
            "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        )}
        style={{ width: d.size.w, height: d.size.h }}
        title={`agent node: ${d.nodeId}`}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate">{d.nodeId}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          no schema advertised
        </span>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  // Materialise effective values: explicit override wins, else
  // schema default. NodeInlineConfig wants both the merged values
  // and the set of override keys (for the inline reset affordance).
  const schemaProps = d.schema.properties ?? {};
  const defaults = d.defaults ?? {};
  const overrideKeys = new Set(Object.keys(overrides));
  const values: Record<string, unknown> = {};
  for (const fieldName of Object.keys(schemaProps)) {
    values[fieldName] = overrideKeys.has(fieldName)
      ? overrides[fieldName]
      : defaults[fieldName];
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border-2 p-2 shadow-sm transition-all",
        visual.tone,
        selected &&
          "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
      )}
      style={{ width: d.size.w, height: d.size.h }}
      title={`agent node: ${d.nodeId}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">{d.nodeId}</span>
        {overrideKeys.size > 0 && (
          <span className="ml-auto rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
            {overrideKeys.size}
          </span>
        )}
      </div>
      <NodeInlineConfig
        schema={d.schema}
        values={values}
        overrideKeys={overrideKeys}
        onChange={(field, value) =>
          setField(d.agentId, d.nodeId, field, value)
        }
        onOpenPromptSheet={() => d.onOpenPromptSheet?.(d.nodeId)}
        className="flex-1 overflow-y-auto"
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// Stable empty-object sentinel for the zustand selector. Returning a
// fresh `{}` from a selector would trigger React's getSnapshot warning
// and an infinite render loop.
const EMPTY_OBJ: Record<string, unknown> = Object.freeze({});

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

// ─── Floating edges ─────────────────────────────────────────────────
// Edges anchor to the nearest point on each node's perimeter instead
// of fixed handle positions. Standard reactflow recipe (see official
// "floating edges" example). The result: edges always exit / enter on
// the side facing the other node, never crossing a node's body.

/**
 * Returns the point on `intersectionNode`'s rectangle perimeter that
 * lies on the line drawn from intersectionNode's centre to
 * targetNode's centre. Pure geometry — the ellipse approximation
 * trick reactflow's example uses, which is exact for axis-aligned
 * rectangles.
 */
function getNodeIntersection(
  intersectionNode: InternalNode,
  targetNode: InternalNode,
): { x: number; y: number } {
  const iw = intersectionNode.measured?.width ?? 0;
  const ih = intersectionNode.measured?.height ?? 0;
  const ipos = intersectionNode.internals.positionAbsolute;
  const tpos = targetNode.internals.positionAbsolute;
  const tw = targetNode.measured?.width ?? 0;
  const th = targetNode.measured?.height ?? 0;

  const w = iw / 2;
  const h = ih / 2;
  const x2 = ipos.x + w;
  const y2 = ipos.y + h;
  const x1 = tpos.x + tw / 2;
  const y1 = tpos.y + th / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return {
    x: w * (xx3 + yy3) + x2,
    y: h * (yy3 - xx3) + y2,
  };
}

/** Which side of `node` does `intersectionPoint` lie on? */
function getEdgePosition(
  node: InternalNode,
  intersectionPoint: { x: number; y: number },
): Position {
  const n = { ...node.internals.positionAbsolute, ...node };
  const nx = Math.round(n.x);
  const ny = Math.round(n.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  if (px <= nx + 1) return Position.Left;
  if (px >= nx + w - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + h - 1) return Position.Bottom;
  return Position.Top;
}

function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);
  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}

/** Custom edge that recomputes its anchor points on every render from
 * the source + target nodes' live positions. */
function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });
  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={path}
      markerEnd={markerEnd}
      style={style}
      fill="none"
    />
  );
}

const EDGE_TYPES = { floating: FloatingEdge };

export function ReactFlowAgentTopology({
  topology,
  agentId,
  agentTools = [],
  selectedNodeId,
  onNodeSelect,
  onOpenPromptSheet,
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
          size: getNodeSize(n),
          toolList: agentTools,
          onOpenPromptSheet,
        } satisfies CommonNodeData,
        draggable: false,
        selectable: true,
      })),
    [
      topology.nodes,
      positions,
      agentId,
      selectedNodeId,
      agentTools,
      onOpenPromptSheet,
    ],
  );

  const edges: Edge[] = useMemo(
    () =>
      topology.edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        // FloatingEdge recomputes anchor points on every render; the
        // edge enters / exits on whichever side of each node faces the
        // other one.
        type: "floating",
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
        // Default: fill the parent's flex container. Callers can
        // override (e.g. fixed height) via className. The earlier
        // hardcoded h-[520px] is gone so the viewport-bound layout
        // (T4') can size the canvas dynamically.
        "h-full w-full bg-card/30 overflow-hidden",
        // FloatingEdge anchors edges to the perimeter, so the visible
        // <Handle/> dots are now misleading (they sit at top/bottom
        // centre while the edge meets the node somewhere else).
        // Hide them globally — handles still exist in the DOM for
        // reactflow's edge-validation path, just invisible.
        "[&_.react-flow__handle]:opacity-0 [&_.react-flow__handle]:pointer-events-none",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
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
