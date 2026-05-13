/**
 * Pure-function layout module for the agent topology canvas.
 *
 * Computes per-node dimensions (start/end chips, tools cards, agent
 * cards sized from their schema, ensemble-group cards sized from
 * group + member schemas) and runs dagre to place them. The
 * orchestrator hands the resulting positions to reactflow as static
 * coordinates — we don't let the operator re-drag because the layout
 * is meant to mirror the LangGraph topology.
 */
import dagre from "@dagrejs/dagre";
import type {
  AgentConfigSchema,
  AgentTopology,
  AgentTopologyGroup,
  AgentTopologyNode,
} from "../../../agent/events.js";

// Sizing for the fixed-shape node types (start/end/tools). Agent nodes
// size themselves from their schema field count — see
// computeAgentNodeSize().
export const FIXED_NODE_SIZES: Record<
  "start" | "end" | "tools",
  { w: number; h: number }
> = {
  start: { w: 140, h: 44 },
  end: { w: 140, h: 44 },
  tools: { w: 220, h: 96 },
};
export const AGENT_NODE_WIDTH = 300;
export const AGENT_HEADER_PX = 30; // icon + nodeId row
export const AGENT_ROW_PX = 28; // one schema field, inline control
export const AGENT_VERTICAL_PADDING = 24; // top + bottom card padding
export const AGENT_MIN_HEIGHT = 80;
export const AGENT_MAX_HEIGHT = 360;

export function computeAgentNodeSize(
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

export function getNodeSize(node: AgentTopologyNode): { w: number; h: number } {
  if (node.type === "agent") return computeAgentNodeSize(node.config_schema);
  return FIXED_NODE_SIZES[node.type];
}

// Ensemble-group card: slightly wider than a regular agent card. The
// schema's `maximum` on the instance-count field bounds the upper
// height so the card doesn't resize on every instance-count change.
export const ENSEMBLE_GROUP_WIDTH = 340;
export const ENSEMBLE_HEADER_PX = 24;
export const ENSEMBLE_ROW_PX = 28;
export const ENSEMBLE_VERTICAL_PADDING_PX = 24;
export const ENSEMBLE_MAX_HEIGHT = 480;

export function computeEnsembleGroupSize(
  group: AgentTopologyGroup,
  memberSchema: AgentConfigSchema | null,
): { w: number; h: number } {
  const groupProps = group.config_schema?.properties ?? {};
  const memberProps = memberSchema?.properties ?? {};
  // Skip ui.widget="hidden" fields — NodeInlineConfig filters them so
  // they don't take vertical space.
  const visibleGroupFields = Object.values(groupProps).filter(
    (f) => f.ui?.widget !== "hidden",
  ).length;
  const visibleMemberFields = Object.values(memberProps).filter(
    (f) => f.ui?.widget !== "hidden",
  ).length;
  // Member form gets its own sub-header strip (~24px) when present.
  const memberHeaderPx = visibleMemberFields > 0 ? 28 : 0;
  const h = Math.min(
    ENSEMBLE_HEADER_PX +
      visibleGroupFields * ENSEMBLE_ROW_PX +
      memberHeaderPx +
      visibleMemberFields * ENSEMBLE_ROW_PX +
      ENSEMBLE_VERTICAL_PADDING_PX,
    ENSEMBLE_MAX_HEIGHT,
  );
  return { w: ENSEMBLE_GROUP_WIDTH, h };
}

export const RANK_SEP = 60;
export const NODE_SEP = 80;

// Compound-container padding. The group's bounding box grows by this
// many pixels on each side so children don't touch the dashed border,
// and a `GROUP_LABEL_BAND` strip at the top is reserved for the
// group's label ("actor-critic loop" / "ensemble").
export const GROUP_PADDING = 24;
export const GROUP_LABEL_BAND = 28;

export function buildEnsembleByMemberId(
  topology: AgentTopology,
): Map<string, AgentTopologyGroup> {
  const out = new Map<string, AgentTopologyGroup>();
  for (const g of topology.groups ?? []) {
    if (!g.config_schema) continue;
    for (const n of topology.nodes) {
      if (n.group_id === g.id) out.set(n.id, g);
    }
  }
  return out;
}

export function getRenderedNodeSize(
  node: AgentTopologyNode,
  ensembleByMember: Map<string, AgentTopologyGroup>,
): { w: number; h: number } {
  const eg = ensembleByMember.get(node.id);
  if (eg) return computeEnsembleGroupSize(eg, node.config_schema);
  return getNodeSize(node);
}

export function layoutWithDagre(
  topology: AgentTopology,
  ensembleByMember: Map<string, AgentTopologyGroup>,
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
    const size = getRenderedNodeSize(n, ensembleByMember);
    g.setNode(n.id, { width: size.w, height: size.h });
  }
  for (const e of topology.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const out: Record<string, { x: number; y: number }> = {};
  for (const n of topology.nodes) {
    const d = g.node(n.id) as { x: number; y: number };
    const size = getRenderedNodeSize(n, ensembleByMember);
    // dagre reports centre points; reactflow uses top-left corners.
    out[n.id] = { x: d.x - size.w / 2, y: d.y - size.h / 2 };
  }
  return out;
}
