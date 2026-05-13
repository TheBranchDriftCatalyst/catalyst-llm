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
import { Activity, CircleDot, Flag, History, Users, Wrench } from "lucide-react";
import type {
  AgentConfigSchema,
  AgentTopology,
  AgentTopologyGroup,
  AgentTopologyNode,
  GroupType,
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

// Width + height for an ensemble-group card. Slightly wider than a
// regular agent card (it has a 'members' section beneath the form)
// and uses the schema's `maximum` on the instance-count field as the
// upper bound so the card doesn't resize on every instance-count
// change. Internal scroll handles smaller counts.
const ENSEMBLE_GROUP_WIDTH = 340;
const ENSEMBLE_HEADER_PX = 24;
const ENSEMBLE_ROW_PX = 28;
const ENSEMBLE_MEMBER_ROW_PX = 22;
const ENSEMBLE_MEMBERS_OVERHEAD_PX = 28;
const ENSEMBLE_VERTICAL_PADDING_PX = 24;
const ENSEMBLE_MAX_HEIGHT = 480;

function computeEnsembleGroupSize(
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

const RANK_SEP = 60;
const NODE_SEP = 80;

// Compound-container padding. We grow the group's bounding box by this
// many pixels on each side so children don't touch the dashed border,
// and reserve a `GROUP_LABEL_BAND` strip at the top for the group's
// "actor-critic loop" / "ensemble" label.
const GROUP_PADDING = 24;
const GROUP_LABEL_BAND = 28;

// Group-container visual styling. Keeps tone parity with NODE_VISUAL
// above so the canvas reads as one palette.
const GROUP_VISUAL: Record<
  GroupType,
  { label: string; border: string; bg: string; text: string }
> = {
  actor_critic_loop: {
    label: "actor-critic loop",
    // dashed border conveys "this is the feedback loop region"; the
    // primary/violet tint reads as the LLM-driven part of the graph.
    border: "border-violet-400/60",
    bg: "bg-violet-500/[0.06]",
    text: "text-violet-200",
  },
  ensemble: {
    label: "ensemble",
    border: "border-amber-400/60",
    bg: "bg-amber-500/[0.06]",
    text: "text-amber-200",
  },
};

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
  /** See ReactFlowAgentTopologyProps.activeNodeId — node cards
   * render a pulsing ring when their id matches. */
  activeNodeId: string | undefined;
  /** Computed pixel size — also fed to dagre. Cards style themselves
   * with these explicit width/height values to match. */
  size: { w: number; h: number };
  /** Tools to render on `tools` nodes. Other node types ignore. */
  toolList: string[];
  /** Called when the prompt-icon button on an agent node is clicked. */
  onOpenPromptSheet?: (nodeId: string) => void;
  /** Called when the runs-icon button on an agent / tools node is clicked. */
  onOpenRunsSheet?: (nodeId: string) => void;
  /** Called when the __start__ chip is clicked. Only set on the
   * start chip; other node types ignore. */
  onStartTestRun?: () => void;
}

/** Map a member-template-node id → the ensemble group it belongs to.
 * Only includes groups with a non-null config_schema (the new
 * configured-ensemble shape); legacy group_type wrappers go through a
 * different rendering path. */
function buildEnsembleByMemberId(
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

function getRenderedNodeSize(
  node: AgentTopologyNode,
  ensembleByMember: Map<string, AgentTopologyGroup>,
): { w: number; h: number } {
  const eg = ensembleByMember.get(node.id);
  if (eg) return computeEnsembleGroupSize(eg, node.config_schema);
  return getNodeSize(node);
}

function layoutWithDagre(
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

// ─── Custom node components ──────────────────────────────────────────

function StartEndChip({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL[d.type];
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  const active = d.activeNodeId === d.nodeId;
  const runnable = d.type === "start" && typeof d.onStartTestRun === "function";
  const className = cn(
    "flex h-[44px] w-[140px] items-center gap-2 rounded-full border-2 px-4 text-sm font-mono shadow-sm transition-all",
    visual.tone,
    selected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
    active && "ring-2 ring-primary animate-pulse",
    runnable && "cursor-pointer hover:ring-2 hover:ring-primary/40",
  );
  const handles = (
    <>
      {d.type !== "start" && <Handle type="target" position={Position.Top} />}
      {d.type !== "end" && <Handle type="source" position={Position.Bottom} />}
    </>
  );
  // Make the start chip a real button when a test-run dispatcher is
  // wired up — clicking it opens the TestRunBody for this agent. The
  // .nodrag/.nopan guard stops reactflow from interpreting the click
  // as the start of a canvas drag.
  if (runnable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          d.onStartTestRun?.();
        }}
        className={cn(className, "nodrag")}
        title={`start: ${d.nodeId} — click to dispatch a test run`}
      >
        {handles}
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{d.nodeId}</span>
      </button>
    );
  }
  return (
    <div className={className} title={`${visual.label}: ${d.nodeId}`}>
      {handles}
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{d.nodeId}</span>
    </div>
  );
}

function ToolsNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.tools;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  const active = d.activeNodeId === d.nodeId;
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
    active && "ring-2 ring-primary animate-pulse",
      )}
      title={`tools dispatcher: ${d.nodeId}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">{d.nodeId}</span>
        <RunsIconButton
          onClick={() => d.onOpenRunsSheet?.(d.nodeId)}
          className="ml-auto"
        />
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

/**
 * Tiny ghost-style icon button that opens the per-node runs Sheet
 * (NodeRunsList) when clicked. Shared by AgentNodeCard and
 * ToolsNodeCard so both tap into the same trigger affordance.
 *
 * Uses raw <button> rather than the catalyst-ui <Button> because the
 * icon-only sizing inside a 28px-tall card row needs tighter padding
 * than <Button size="sm"> exposes. The `nodrag` class keeps reactflow
 * from treating a click as a node-drag start (the parent card has
 * `draggable: false` but the handler still pre-empts the event).
 */
function RunsIconButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Stop the click from bubbling to the node-click handler that
        // toggles selection — the runs sheet is a distinct affordance.
        e.stopPropagation();
        onClick();
      }}
      title="Recent runs on this node"
      className={cn(
        "nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        className,
      )}
    >
      <History className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

function AgentNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.agent;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  const active = d.activeNodeId === d.nodeId;

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
          <RunsIconButton
            onClick={() => d.onOpenRunsSheet?.(d.nodeId)}
            className="ml-auto"
          />
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
        <RunsIconButton
          onClick={() => d.onOpenRunsSheet?.(d.nodeId)}
          // When the override badge is absent, push the button to the
          // right edge of the header. When it's present, the badge
          // already takes `ml-auto` so the button sits flush to it.
          className={overrideKeys.size > 0 ? "" : "ml-auto"}
        />
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

// ─── Group container ────────────────────────────────────────────────
// Pure visual wrapper. Children's `parentId` points at this node, so
// reactflow places them relative to its origin; this card just paints
// the dashed border + label band. No handles — edges still run
// between the original child node ids.

interface GroupNodeData extends Record<string, unknown> {
  groupType: GroupType;
}

function GroupContainerNode({ data }: NodeProps) {
  const d = data as GroupNodeData;
  const visual = GROUP_VISUAL[d.groupType];
  return (
    <div
      // h/w come from the synthetic node's inline style (we size it to
      // exactly enclose its children); this div just fills that box.
      className={cn(
        "relative h-full w-full rounded-lg border-2 border-dashed pointer-events-none",
        visual.border,
        visual.bg,
      )}
    >
      <div
        className={cn(
          "absolute left-2 top-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
          visual.text,
        )}
      >
        <span>{visual.label}</span>
      </div>
    </div>
  );
}

// ─── EnsembleGroupCard ──────────────────────────────────────────────
// First-class container for ensemble groups (topology.groups[] entries
// with config_schema set). Owns the SHARED per-member config form +
// renders N member-preview cards inside (count driven by the live
// value of the group's instance_count_field).
//
// Per-member overrides are NOT supported in v1 — every member reads
// the same group config. Matches the catalyst-langgraph runtime
// which fans out N identical asyncio.gather calls.

interface EnsembleGroupData extends Record<string, unknown> {
  agentId: string;
  /** The group's id — engineStore key for the ensemble-orchestration
   * config bucket (council_size, etc). */
  groupId: string;
  /** The template member node's id (e.g. "members"). The reactflow
   * node uses this id so edges still attach; selection / event
   * attribution routes through this same id since the runtime emits
   * events under the template node, not the group. Also the
   * engineStore key for per-member LLM tunables. */
  templateNodeId: string;
  /** Group config schema (ensemble orchestration — council_size). */
  schema: AgentConfigSchema | null;
  defaults: Record<string, unknown> | null;
  /** Per-member template config schema (model, temperature, …) read
   * from the member node's own descriptor. */
  memberSchema: AgentConfigSchema | null;
  memberDefaults: Record<string, unknown> | null;
  instanceCountField: string | null;
  label: string | null;
  selectedNodeId: string | undefined;
  activeNodeId: string | undefined;
  size: { w: number; h: number };
  onOpenPromptSheet?: (entityId: string) => void;
  /** Opens the per-node runs sheet keyed on `templateNodeId` — the
   * runtime emits events under that id, so the runs query matches the
   * actual event log. */
  onOpenRunsSheet?: (nodeId: string) => void;
}

function EnsembleGroupCard({ data }: NodeProps) {
  const d = data as EnsembleGroupData;
  const selected = d.selectedNodeId === d.templateNodeId;
  const active = d.activeNodeId === d.templateNodeId;

  const setField = useEngineStore((s) => s.setField);

  // Group-level overrides (ensemble orchestration — council_size).
  const groupOverridesRaw = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.groupId],
  );
  const groupOverrides = groupOverridesRaw ?? EMPTY_OBJ;

  // Per-member template overrides (model, temperature, …) keyed by the
  // template node id, NOT the group id. Edits to the member form below
  // write here.
  const memberOverridesRaw = useEngineStore(
    (s) => s.configs[d.agentId]?.[d.templateNodeId],
  );
  const memberOverrides = memberOverridesRaw ?? EMPTY_OBJ;

  if (!d.schema) {
    return (
      <div
        className="rounded-lg border-2 border-dashed border-amber-400/60 bg-amber-500/[0.06] p-3"
        style={{ width: d.size.w, height: d.size.h }}
      >
        <Handle type="target" position={Position.Top} />
        ensemble: no schema
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  // Merge group overrides over group defaults.
  const groupSchemaProps = d.schema.properties ?? {};
  const groupDefaults = d.defaults ?? {};
  const groupOverrideKeys = new Set(Object.keys(groupOverrides));
  const groupValues: Record<string, unknown> = {};
  for (const fieldName of Object.keys(groupSchemaProps)) {
    groupValues[fieldName] = groupOverrideKeys.has(fieldName)
      ? groupOverrides[fieldName]
      : groupDefaults[fieldName];
  }

  // Merge member overrides over member defaults (when the template
  // node has its own schema). The form below renders only when both
  // are present; otherwise the card degrades to the group-only form.
  const memberSchemaProps = d.memberSchema?.properties ?? {};
  const memberDefaults = d.memberDefaults ?? {};
  const memberOverrideKeys = new Set(Object.keys(memberOverrides));
  const memberValues: Record<string, unknown> = {};
  for (const fieldName of Object.keys(memberSchemaProps)) {
    memberValues[fieldName] = memberOverrideKeys.has(fieldName)
      ? memberOverrides[fieldName]
      : memberDefaults[fieldName];
  }

  // Live instance count from the group's config — bounded.
  const instanceCount = d.instanceCountField
    ? Math.max(
        1,
        Math.min(
          12,
          Number(
            groupValues[d.instanceCountField] ??
              groupDefaults[d.instanceCountField] ??
              1,
          ),
        ),
      )
    : 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border-2 p-2 shadow-sm transition-all",
        "border-amber-400/60 bg-amber-500/[0.06]",
        selected &&
          "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        active && "ring-2 ring-primary animate-pulse",
      )}
      style={{ width: d.size.w, height: d.size.h }}
      title={`${d.label ?? d.groupId}: ${instanceCount} member${instanceCount === 1 ? "" : "s"}`}
    >
      <Handle type="target" position={Position.Top} />

      {/* Group header — label + Nx badge + runs button */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
          <Users className="h-3 w-3" aria-hidden="true" />
          {d.label ?? d.groupId}
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-sm border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-100">
            {instanceCount}×
          </span>
          {d.onOpenRunsSheet && (
            <RunsIconButton
              onClick={() => d.onOpenRunsSheet?.(d.templateNodeId)}
            />
          )}
        </div>
      </div>

      {/* Group form — ensemble-level orchestration only (council_size).
       * Writes to engineStore keyed by the group id. */}
      <NodeInlineConfig
        schema={d.schema}
        values={groupValues}
        overrideKeys={groupOverrideKeys}
        onChange={(field, value) =>
          setField(d.agentId, d.groupId, field, value)
        }
        onOpenPromptSheet={() => d.onOpenPromptSheet?.(d.groupId)}
        className="shrink-0"
      />

      {/* Member-template form — per-member LLM tunables (model,
       * temperature, system_prompt, …). Writes to engineStore keyed
       * by the template node id. Shared by all N members. */}
      {d.memberSchema && (
        <>
          <div className="flex shrink-0 items-center gap-1.5 border-t border-amber-500/20 pt-2 text-[10px] font-bold uppercase tracking-wider text-amber-200/80">
            <Activity className="h-3 w-3" aria-hidden="true" />
            subagent · template
          </div>
          <NodeInlineConfig
            schema={d.memberSchema}
            values={memberValues}
            overrideKeys={memberOverrideKeys}
            onChange={(field, value) =>
              setField(d.agentId, d.templateNodeId, field, value)
            }
            onOpenPromptSheet={() =>
              d.onOpenPromptSheet?.(d.templateNodeId)
            }
            className="shrink-0"
          />
        </>
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
  groupContainer: GroupContainerNode,
  ensembleGroup: EnsembleGroupCard,
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
