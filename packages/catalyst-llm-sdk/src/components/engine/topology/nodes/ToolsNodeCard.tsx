/**
 * Medium card for `tools` nodes. Renders either a single matched
 * tool chip (when the node id IS a specific tool like
 * `research.web_search`) or every tool the agent advertises (when
 * it's the generic dispatcher node, e.g. `main.tools`).
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../shared/utils.js";
import { NODE_VISUAL } from "./visuals.js";
import type { CommonNodeData } from "./data-types.js";
import { RunsIconButton } from "./RunsIconButton.js";

export function ToolsNodeCard({ data }: NodeProps) {
  const d = data as CommonNodeData;
  const visual = NODE_VISUAL.tools;
  const Icon = visual.icon;
  const selected = d.selectedNodeId === d.nodeId;
  const active = d.activeNodeId === d.nodeId;
  // If the node's id matches one of the agent's registered tools, this
  // node IS that specific tool — show just that one chip. Otherwise
  // it's the generic dispatcher and we list every tool the agent advertises.
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
