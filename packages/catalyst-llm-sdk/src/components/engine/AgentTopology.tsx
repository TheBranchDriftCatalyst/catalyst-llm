/**
 * Static topology renderer for an Agent's LangGraph state machine.
 *
 * Uses @dagrejs/dagre to compute node positions (top-down layered
 * layout), renders nodes as absolutely-positioned <div>s and edges
 * as SVG <path>s. v2 will subscribe to live SSE events on the active
 * chat and flip the executing node's `data-active` flag so the
 * operator sees the graph "light up" as the agent runs.
 *
 * Why dagre over React Flow:
 *   - dagre is already pulled in transitively (mermaid uses it), only
 *     the tiny @dagrejs/dagre layout binding is a direct dep — no
 *     React Flow ~200 KB bundle.
 *   - We don't need interactive node dragging or pan/zoom; the graphs
 *     are 3–5 nodes. Static layout is plenty.
 *   - HTML nodes are easier to style with our existing Tailwind /
 *     catalyst-ui tokens than React Flow's port-based node API.
 */
import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { Activity, CircleDot, Flag, Wrench } from "lucide-react";
import type {
  AgentTopology,
  AgentTopologyNode,
} from "../../agent/events.js";
import { cn } from "../utils.js";

export interface AgentTopologyProps {
  topology: AgentTopology;
  /** Node id to highlight (e.g. live-activity in v2). Undefined = no highlight. */
  activeNodeId?: string;
  className?: string;
}

const NODE_W = 140;
const NODE_H = 48;
const RANK_SEP = 70;
const NODE_SEP = 80;
const PADDING = 24;

interface PositionedNode extends AgentTopologyNode {
  x: number;
  y: number;
}

interface PositionedEdge {
  source: string;
  target: string;
  conditional: boolean;
  path: string;
}

/**
 * Run dagre on the topology and produce absolute pixel coordinates
 * for each node + an SVG cubic-bezier path for each edge. Memoised
 * on topology identity so re-renders don't recompute the layout.
 */
function layoutTopology(topology: AgentTopology): {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: PADDING,
    marginy: PADDING,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of topology.nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of topology.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const graphInfo = g.graph();
  const width = (graphInfo.width as number) ?? 400;
  const height = (graphInfo.height as number) ?? 300;

  const nodes: PositionedNode[] = topology.nodes.map((n) => {
    const d = g.node(n.id) as { x: number; y: number };
    return { ...n, x: d.x, y: d.y };
  });

  const edges: PositionedEdge[] = topology.edges.map((e) => {
    const points = (g.edge(e.source, e.target) as { points: { x: number; y: number }[] }).points;
    return {
      source: e.source,
      target: e.target,
      conditional: e.conditional,
      path: edgePath(points),
    };
  });

  return { width, height, nodes, edges };
}

/**
 * Convert dagre's polyline waypoints into a smooth cubic-bezier path.
 * dagre gives us 3+ control points; we collapse them into a single
 * cubic to keep edges visually clean for these small graphs.
 */
function edgePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const start = points[0];
  const end = points[points.length - 1];
  // Vertical mid-control gives a clean S-curve for top-down layouts.
  const c1y = start.y + (end.y - start.y) * 0.5;
  const c2y = start.y + (end.y - start.y) * 0.5;
  return `M ${start.x} ${start.y} C ${start.x} ${c1y}, ${end.x} ${c2y}, ${end.x} ${end.y}`;
}

const NODE_STYLES: Record<
  AgentTopologyNode["type"],
  { icon: typeof Activity; label: string; tone: string }
> = {
  start: { icon: Flag, label: "start", tone: "bg-emerald-500/15 text-emerald-200 border-emerald-500/50" },
  end: { icon: CircleDot, label: "end", tone: "bg-rose-500/15 text-rose-200 border-rose-500/50" },
  agent: { icon: Activity, label: "agent", tone: "bg-primary/15 text-primary border-primary/50" },
  // Higher background opacity than the others — `tools` was getting
  // visually crowded out by neighbouring edges and harder to read
  // against the dark canvas.
  tools: { icon: Wrench, label: "tools", tone: "bg-amber-500/15 text-amber-200 border-amber-500/50" },
};

export function AgentTopologyView({
  topology,
  activeNodeId,
  className,
}: AgentTopologyProps) {
  const layout = useMemo(() => layoutTopology(topology), [topology]);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border/60 bg-card/30 p-2 overflow-auto",
        className,
      )}
      style={{
        minHeight: `${layout.height + PADDING * 2}px`,
        minWidth: `${layout.width + PADDING * 2}px`,
      }}
      aria-label="Agent topology"
      role="img"
    >
      {/* Edges underneath the nodes. */}
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={layout.width + PADDING * 2}
        height={layout.height + PADDING * 2}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/70" />
          </marker>
          <marker
            id="arrow-conditional"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-accent/80" />
          </marker>
        </defs>
        {layout.edges.map((e) => (
          <path
            key={`${e.source}->${e.target}`}
            d={e.path}
            transform={`translate(${PADDING}, ${PADDING})`}
            className={cn(
              "fill-none",
              e.conditional
                ? "stroke-accent/80 [stroke-dasharray:6_4]"
                : "stroke-muted-foreground/70",
            )}
            strokeWidth={1.5}
            markerEnd={e.conditional ? "url(#arrow-conditional)" : "url(#arrow)"}
          />
        ))}
      </svg>

      {/* Nodes on top. */}
      {layout.nodes.map((n) => {
        const style = NODE_STYLES[n.type];
        const Icon = style.icon;
        const active = activeNodeId === n.id;
        return (
          <div
            key={n.id}
            data-active={active || undefined}
            className={cn(
              "absolute flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm transition-all",
              style.tone,
              active && "ring-2 ring-primary/60 scale-105",
            )}
            style={{
              width: NODE_W,
              height: NODE_H,
              left: n.x - NODE_W / 2 + PADDING,
              top: n.y - NODE_H / 2 + PADDING,
            }}
            title={`${style.label}: ${n.id}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{n.id}</span>
          </div>
        );
      })}
    </div>
  );
}
