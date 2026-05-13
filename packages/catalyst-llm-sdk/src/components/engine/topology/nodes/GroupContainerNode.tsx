/**
 * Pure visual wrapper for legacy compound groups (those without their
 * own config_schema — e.g. plain `actor_critic_loop` regions).
 * Children's `parentId` points at this node so reactflow places them
 * relative to its origin; this card just paints the dashed border +
 * label band. No handles — edges still run between the original
 * child node ids.
 *
 * Ensemble groups with a config_schema use EnsembleGroupCard instead.
 */
import type { NodeProps } from "@xyflow/react";
import { cn } from "../../../shared/utils.js";
import { GROUP_VISUAL } from "./visuals.js";
import type { GroupNodeData } from "./data-types.js";

export function GroupContainerNode({ data }: NodeProps) {
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
