/**
 * Public surface of the nodes/ family.
 *
 * The orchestrator reads NODE_TYPES + the three data-shape interfaces;
 * individual node components are private to this folder. Visual
 * constants are exported so other surfaces (legends, debug overlays)
 * can match the canvas palette.
 */
import { StartEndChip } from "./StartEndChip.js";
import { ToolsNodeCard } from "./ToolsNodeCard.js";
import { AgentNodeCard } from "./AgentNodeCard.js";
import { GroupContainerNode } from "./GroupContainerNode.js";
import { EnsembleGroupCard } from "./EnsembleGroupCard.js";

export const NODE_TYPES = {
  start: StartEndChip,
  end: StartEndChip,
  tools: ToolsNodeCard,
  agent: AgentNodeCard,
  groupContainer: GroupContainerNode,
  ensembleGroup: EnsembleGroupCard,
};

export type {
  CommonNodeData,
  GroupNodeData,
  EnsembleGroupData,
} from "./data-types.js";
export { GROUP_VISUAL, NODE_VISUAL } from "./visuals.js";
