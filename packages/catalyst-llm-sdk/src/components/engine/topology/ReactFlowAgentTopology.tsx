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
 * Selection is owned by the parent (EnginePage): `selectedNodeId`
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
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  AgentTopology,
  AgentTopologyNode,
  GroupType,
} from "../../../agent/events.js";
import { cn } from "../../shared/utils.js";
import {
  GROUP_LABEL_BAND,
  GROUP_PADDING,
  buildEnsembleByMemberId,
  computeEnsembleGroupSize,
  getNodeSize,
  layoutWithDagre,
} from "./layout.js";
import {
  EDGE_CONDITIONAL,
  EDGE_SOLID,
  EDGE_TYPES,
} from "./edges/index.js";
import {
  NODE_TYPES,
  type CommonNodeData,
  type EnsembleGroupData,
  type GroupNodeData,
} from "./nodes/index.js";

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
  /** Node id currently executing during a live run. Renders as a
   * pulsing brighter ring; distinct from `selectedNodeId` (which is
   * operator-clicked, static). Driven by TestRunBody's streamed
   * event attribution. */
  activeNodeId?: string;
  /** Fires on node click (with node id) AND on pane click (with `undefined`). */
  onNodeSelect?: (nodeId: string | undefined) => void;
  /** Called when a node's prompt-icon button is clicked. Lets the
   * EnginePage open the contextual Sheet scoped to that node. */
  onOpenPromptSheet?: (nodeId: string) => void;
  /** Called when a node's runs-icon button is clicked. Symmetric with
   * `onOpenPromptSheet` — the EnginePage flips its sheetContext to
   * `{ kind: "runs", agentId, nodeId }` and renders NodeRunsList. */
  onOpenRunsSheet?: (nodeId: string) => void;
  /** Called when the __start__ chip is clicked. EnginePage flips
   * sheetContext to `{ kind: "test-run", agentId }` and renders the
   * TestRunBody so the operator can dispatch a one-shot chat request
   * through this Agent's flow without leaving the Engine tab. */
  onStartTestRun?: () => void;
  className?: string;
}

export function ReactFlowAgentTopology({
  topology,
  agentId,
  agentTools = [],
  selectedNodeId,
  activeNodeId,
  onNodeSelect,
  onOpenPromptSheet,
  onOpenRunsSheet,
  onStartTestRun,
  className,
}: ReactFlowAgentTopologyProps) {
  // Map of member-template-node id → ensemble group descriptor for any
  // group that owns its own config_schema. Members of such groups are
  // rendered as ONE EnsembleGroupCard at the template node's id; we
  // skip emitting them as plain agent cards in the nodes builder
  // below.
  const ensembleByMember = useMemo(
    () => buildEnsembleByMemberId(topology),
    [topology],
  );

  const positions = useMemo(
    () => layoutWithDagre(topology, ensembleByMember),
    [topology, ensembleByMember],
  );

  // ─── Group containers ─────────────────────────────────────────────
  // Legacy compound-container layout for groups that DON'T own their
  // own config_schema (e.g. plain `actor_critic_loop` wrappers). Groups
  // with a config_schema render as a single first-class EnsembleGroupCard
  // instead and skip this path entirely.
  //
  // Cluster topology.nodes by `group_id` and synthesise one container
  // node per cluster. The container's bounding box is the axis-aligned
  // hull of its children (plus padding + a label band on top); each
  // grouped child gets `parentId` + a position translated to be
  // relative to the container's origin.
  //
  // Dagre laid the nodes out absolutely before we did the grouping —
  // so we keep dagre's positions for ungrouped nodes (and for edges
  // which still target the original child ids) and only translate
  // grouped children. Edges keep working because reactflow's
  // FloatingEdge reads each node's resolved absolute position at
  // render time.
  const groupedLayout = useMemo(() => {
    const groupBuckets = new Map<string, { type: GroupType; members: AgentTopologyNode[] }>();
    for (const n of topology.nodes) {
      // Skip members of first-class ensemble groups — they render as a
      // single EnsembleGroupCard, not as wrapped child nodes.
      if (ensembleByMember.has(n.id)) continue;
      if (n.group_id && n.group_type) {
        let bucket = groupBuckets.get(n.group_id);
        if (!bucket) {
          bucket = { type: n.group_type, members: [] };
          groupBuckets.set(n.group_id, bucket);
        }
        bucket.members.push(n);
      }
    }
    type GroupBox = {
      id: string;
      type: GroupType;
      position: { x: number; y: number };
      size: { w: number; h: number };
    };
    const groups: GroupBox[] = [];
    // map childId → { groupId, relPosition }
    const childAdjustments = new Map<
      string,
      { groupId: string; relX: number; relY: number }
    >();
    for (const [gid, bucket] of groupBuckets) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const m of bucket.members) {
        const pos = positions[m.id] ?? { x: 0, y: 0 };
        const sz = getNodeSize(m);
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + sz.w > maxX) maxX = pos.x + sz.w;
        if (pos.y + sz.h > maxY) maxY = pos.y + sz.h;
      }
      const groupOriginX = minX - GROUP_PADDING;
      const groupOriginY = minY - GROUP_PADDING - GROUP_LABEL_BAND;
      const groupW = maxX - minX + GROUP_PADDING * 2;
      const groupH = maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_BAND;
      const groupNodeId = `group:${gid}`;
      groups.push({
        id: groupNodeId,
        type: bucket.type,
        position: { x: groupOriginX, y: groupOriginY },
        size: { w: groupW, h: groupH },
      });
      for (const m of bucket.members) {
        const pos = positions[m.id] ?? { x: 0, y: 0 };
        childAdjustments.set(m.id, {
          groupId: groupNodeId,
          relX: pos.x - groupOriginX,
          relY: pos.y - groupOriginY,
        });
      }
    }
    return { groups, childAdjustments };
  }, [topology.nodes, positions, ensembleByMember]);

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    // Emit group container nodes first so reactflow knows about them
    // before it sees their children (reactflow accepts either order
    // but ordering parent-first keeps things predictable in devtools).
    for (const g of groupedLayout.groups) {
      out.push({
        id: g.id,
        type: "groupContainer",
        position: g.position,
        // Sizing the synthetic node via `style.width/height` is the
        // path reactflow's docs recommend for group/parent nodes; the
        // GroupContainerNode div uses h-full/w-full to fill that box.
        style: { width: g.size.w, height: g.size.h, zIndex: -1 },
        data: { groupType: g.type } satisfies GroupNodeData,
        draggable: false,
        selectable: false,
      });
    }
    for (const n of topology.nodes) {
      // First-class ensemble groups: emit ONE EnsembleGroupCard at the
      // template node's id. The group's config form lives in the card;
      // edges that targeted the template node still attach because we
      // keep the same id.
      const ensembleGroup = ensembleByMember.get(n.id);
      if (ensembleGroup) {
        out.push({
          id: n.id,
          type: "ensembleGroup",
          position: positions[n.id] ?? { x: 0, y: 0 },
          data: {
            agentId,
            groupId: ensembleGroup.id,
            templateNodeId: n.id,
            schema: ensembleGroup.config_schema,
            defaults: ensembleGroup.config_defaults,
            memberSchema: n.config_schema,
            memberDefaults: n.config_defaults,
            instanceCountField: ensembleGroup.instance_count_field ?? null,
            label: ensembleGroup.label ?? null,
            selectedNodeId,
            activeNodeId,
            size: computeEnsembleGroupSize(ensembleGroup, n.config_schema),
            onOpenPromptSheet,
            onOpenRunsSheet,
          } satisfies EnsembleGroupData,
          draggable: false,
          selectable: true,
        });
        continue;
      }
      const adj = groupedLayout.childAdjustments.get(n.id);
      const base: Node = {
        id: n.id,
        type: n.type,
        position: adj
          ? { x: adj.relX, y: adj.relY }
          : (positions[n.id] ?? { x: 0, y: 0 }),
        data: {
          agentId,
          nodeId: n.id,
          type: n.type,
          schema: n.config_schema,
          defaults: n.config_defaults,
          selectedNodeId,
          activeNodeId,
          size: getNodeSize(n),
          toolList: agentTools,
          onOpenPromptSheet,
          onOpenRunsSheet,
          // Only the __start__ chip receives the dispatcher — wiring
          // it on every node would let any chip click trigger a run,
          // which is wrong. The StartEndChip component double-checks
          // type === "start" before rendering the runnable variant.
          onStartTestRun: n.type === "start" ? onStartTestRun : undefined,
        } satisfies CommonNodeData,
        draggable: false,
        selectable: true,
      };
      if (adj) {
        // parentId tells reactflow the child's position is relative
        // to this node's origin. `extent: "parent"` would also clamp
        // movement, but we already have draggable: false so the
        // simpler parentId binding is enough.
        (base as Node & { parentId: string }).parentId = adj.groupId;
      }
      out.push(base);
    }
    return out;
  }, [
    topology.nodes,
    positions,
    agentId,
    selectedNodeId,
    activeNodeId,
    agentTools,
    onOpenPromptSheet,
    onOpenRunsSheet,
    onStartTestRun,
    groupedLayout,
    ensembleByMember,
  ]);

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
