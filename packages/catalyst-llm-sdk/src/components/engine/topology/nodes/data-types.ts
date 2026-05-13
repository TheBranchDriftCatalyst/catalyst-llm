/**
 * Wire shapes that travel on each reactflow node's `.data` prop.
 *
 * The orchestrator's nodes useMemo builds these and hands them to
 * reactflow; each node-card component reads its shape via
 * `data as CommonNodeData` (or GroupNodeData / EnsembleGroupData).
 * Promoting the contracts to a sibling makes the seam visible
 * without forcing readers to scroll through 100 LOC of card markup
 * to find the prop shape.
 */
import type {
  AgentConfigSchema,
  AgentTopologyNode,
  GroupType,
} from "../../../../agent/events.js";

// selectedNodeId lives here so the highlight ring re-renders when
// selection changes (passing as data is the simplest path; for 5-10
// nodes per agent the re-render cost is irrelevant).
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

export interface GroupNodeData extends Record<string, unknown> {
  groupType: GroupType;
}

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

// Stable empty-object sentinel for zustand selectors. Returning a
// fresh `{}` from a selector would trigger React's getSnapshot warning
// and an infinite render loop. Used by AgentNodeCard + EnsembleGroupCard.
export const EMPTY_OBJ: Record<string, unknown> = Object.freeze({});
