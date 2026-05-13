/**
 * PageShell — explicit page-model layout primitive.
 *
 * Anatomy:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ ┌── left ──┐ ┌── center ─────────────────┐ ┌── right ─┐ │
 *   │ │  Side    │ │                            │ │ Side    │ │
 *   │ │  Panel   │ │  page content (children)   │ │ Panel   │ │
 *   │ │  Items   │ │                            │ │ Items   │ │
 *   │ │  (stack) │ │                            │ │ (stack) │ │
 *   │ └──────────┘ └────────────────────────────┘ └─────────┘ │
 *   │ ┌── bottom ─────────────────────────────────────────────┐ │
 *   │ │ SidePanelItems (stack)                                │ │
 *   │ └───────────────────────────────────────────────────────┘ │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Each side panel is a `SidePanel` that holds a stack of
 * `SidePanelItem` children (collapsible sections with headers).
 * Splitters between every region size each panel independently;
 * sizes persist to localStorage per `storageKey`.
 *
 * This is the catalyst-llm-sdk standard page primitive. The Engine
 * tab composes it with specific items (Agents picker, EventStream,
 * NodeDetail, Terminal, etc); any other app or future surface
 * (Compare/Stats/etc) can compose its own.
 */
import type { ReactNode } from "react";
import { Splitter } from "./Splitter.js";
import { cn } from "../shared/utils.js";
import "./styles.css";

export interface PageShellProps {
  /** Stack of SidePanelItems for the left rail (Agents, EventStream, etc). */
  left?: ReactNode;
  /** Stack of SidePanelItems for the right rail (NodeDetail, RunsList, etc). */
  right?: ReactNode;
  /** Stack of SidePanelItems for the bottom rail (Terminal, Log, etc). */
  bottom?: ReactNode;
  /** Center content — the page's primary work surface (topology canvas,
   * comparison view, stats grid, etc). Fills the remaining grid cell
   * and is the only region not bound to a SidePanel. */
  children: ReactNode;
  /** Optional namespace for storageKey suffixes — set this to a
   * page-specific id so different pages don't share splitter sizes.
   * Defaults to "page" if unset. */
  storageNamespace?: string;
  className?: string;
}

export function PageShell({
  left,
  right,
  bottom,
  children,
  storageNamespace = "page",
  className,
}: PageShellProps) {
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);
  const hasBottom = Boolean(bottom);

  return (
    <div
      className={cn("page-shell", className)}
      data-has-left={hasLeft || undefined}
      data-has-right={hasRight || undefined}
      data-has-bottom={hasBottom || undefined}
    >
      <div className="page-shell-grid">
        {/* Splitters write CSS vars consumed by the grid template. */}
        {hasLeft && (
          <Splitter
            orientation="vertical"
            cssVar="--page-col-left"
            storageKey={`catalyst-llm-sdk:${storageNamespace}:col-left`}
            defaultPx={320}
            minPx={200}
            maxPx={640}
            style={{ gridColumn: 2, gridRow: 1 }}
          />
        )}
        {hasRight && (
          <Splitter
            orientation="vertical"
            cssVar="--page-col-right"
            storageKey={`catalyst-llm-sdk:${storageNamespace}:col-right`}
            defaultPx={480}
            minPx={320}
            maxPx={800}
            invert
            style={{ gridColumn: 4, gridRow: 1 }}
          />
        )}
        {hasBottom && (
          <Splitter
            orientation="horizontal"
            cssVar="--page-row-bottom"
            storageKey={`catalyst-llm-sdk:${storageNamespace}:row-bottom`}
            defaultPx={220}
            minPx={120}
            maxPx={560}
            invert
            style={{ gridColumn: "1 / -1", gridRow: 2 }}
          />
        )}

        {hasLeft && <aside className="page-shell-left">{left}</aside>}
        <main className="page-shell-center">{children}</main>
        {hasRight && <aside className="page-shell-right">{right}</aside>}
        {hasBottom && <footer className="page-shell-bottom">{bottom}</footer>}
      </div>
    </div>
  );
}
