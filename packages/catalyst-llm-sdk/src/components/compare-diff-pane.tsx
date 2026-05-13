/**
 * Inline line-diff renderer for compare-mode response columns.
 * Highlights additions in primary and deletions in destructive
 * red with a strikethrough.
 */
import { useMemo } from "react";
import { lineDiff } from "./diff.js";
import { cn } from "./utils.js";

export interface DiffPaneProps {
  reference: string;
  candidate: string;
}

export function DiffPane({ reference, candidate }: DiffPaneProps) {
  const ops = useMemo(() => lineDiff(reference, candidate), [reference, candidate]);
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
      {ops.map((op, i) => {
        const lines = op.value.split("\n");
        // Last split is empty if value ends in \n; skip rendering it.
        const renderable = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
        return renderable.map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={cn(
              "px-1 -mx-1",
              op.added && "bg-primary/15 text-primary",
              op.removed && "bg-destructive/15 text-destructive line-through opacity-70",
            )}
          >
            <span className="select-none opacity-50 mr-1">
              {op.added ? "+" : op.removed ? "−" : " "}
            </span>
            {line || " "}
          </div>
        ));
      })}
    </pre>
  );
}
