/**
 * SidePanel — vertical stack container for SidePanelItems within a
 * PageShell rail (left / right / bottom).
 *
 * SidePanels don't own layout sizing (PageShell's grid + Splitters do
 * that); SidePanel just provides the scrollable inner container and a
 * consistent gap between items. SidePanelItems are the meaningful
 * units — each is a collapsible section with its own header.
 */
import type { ReactNode } from "react";
import { cn } from "../utils.js";

export interface SidePanelProps {
  /** Stack of SidePanelItem children. */
  children: ReactNode;
  /** Side affects scrollbar gutter handling on the bottom panel (which
   * tends to scroll horizontally instead of vertically for log content),
   * but for left/right it's purely informational. */
  side?: "left" | "right" | "bottom";
  className?: string;
}

export function SidePanel({ children, side = "left", className }: SidePanelProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2",
        side === "bottom" && "flex-row gap-2 overflow-x-auto overflow-y-hidden",
        className,
      )}
      data-side={side}
    >
      {children}
    </div>
  );
}
