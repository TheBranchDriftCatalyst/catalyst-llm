/**
 * Custom node components for the agent-topology canvas.
 *
 *   - StartEndChip       — pill for __start__ / __end__ terminals
 *   - ToolsNodeCard      — medium card with tool-name chips
 *   - AgentNodeCard      — schema-driven card with inline NodeInlineConfig
 *   - GroupContainerNode — dashed visual wrapper for actor-critic loops
 *   - EnsembleGroupCard  — first-class card for configured ensemble groups
 *
 * Plus the shared `CommonNodeData` / `GroupNodeData` / `EnsembleGroupData`
 * shapes that ride on each reactflow node's `.data`, and the
 * `NODE_TYPES` registration map consumed by ReactFlow.
 */
import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import { Activity, CircleDot, Flag, History, Users, Wrench } from "lucide-react";
import type {
  AgentConfigSchema,
  AgentTopologyNode,
  GroupType,
} from "../../../agent/events.js";
import { useEngineStore } from "../../../react/engineStore.js";
import { cn } from "../../shared/utils.js";
import { NodeInlineConfig } from "../NodeInlineConfig.js";

// Group-container visual styling. Keeps tone parity with NODE_VISUAL
// below so the canvas reads as one palette.
export const GROUP_VISUAL: Record<
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
export const NODE_VISUAL: Record<
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
export interface CommonNodeData extends Record<string, unknown> {
  agentId: string;
  nodeId: string;
  type: AgentTopologyNode["type"];
  schema: AgentConfigSchema | null;
  defaults: Record<string, unknown> | null;
  selectedNodeId: string | undefined;
  /** Node cards render a pulsing ring when their id matches. */
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
  // wired up — clicking it opens the TestRunBody for this agent.
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
  // re-renders this card. EMPTY_OBJ keeps reference identity stable.
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

export interface GroupNodeData extends Record<string, unknown> {
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

export interface EnsembleGroupData extends Record<string, unknown> {
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

export const NODE_TYPES = {
  start: StartEndChip,
  end: StartEndChip,
  tools: ToolsNodeCard,
  agent: AgentNodeCard,
  groupContainer: GroupContainerNode,
  ensembleGroup: EnsembleGroupCard,
};
