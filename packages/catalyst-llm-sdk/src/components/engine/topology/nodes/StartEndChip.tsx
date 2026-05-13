/**
 * Pill rendering for __start__ / __end__ terminal nodes. The start
 * variant becomes a clickable button when a `onStartTestRun`
 * dispatcher is wired up — opening the TestRunBody for the agent.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../shared/utils.js";
import { NODE_VISUAL } from "./visuals.js";
import type { CommonNodeData } from "./data-types.js";

export function StartEndChip({ data }: NodeProps) {
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
  // The .nodrag class keeps reactflow from interpreting the click as
  // the start of a canvas drag.
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
