/**
 * SidePanel — stack container for SidePanelItems within a PageShell rail.
 *
 * Owns the layout for its items:
 *   - Left/right rails stack vertically; bottom rail stacks horizontally
 *     (driven by `side` and matching CSS classes).
 *   - Between every pair of adjacent EXPANDED items, a Splitter is
 *     rendered so the operator can drag the boundary between them. The
 *     splitter writes a CSS var consumed by the previous item's
 *     flex-basis; the last expanded item is `flex: 1 1 0` and absorbs
 *     leftover space.
 *   - Sizes persist per-item to localStorage; collapsed/expanded state
 *     persists per-item via SidePanelItem's own storage hook.
 *
 * Items report their collapsed state through `SidePanelCtx` so the panel
 * can recompute the splitter layout when an item collapses or expands.
 * Initial collapsed state is read directly from localStorage (same key
 * as SidePanelItem) so first-paint layout is correct without waiting
 * for the items to mount + dispatch.
 */
import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Splitter } from "../engine-panel/Splitter.js";
import { cn } from "../utils.js";
import { SidePanelItem, type SidePanelItemProps } from "./SidePanelItem.js";
import {
  SidePanelCtx,
  itemCollapsedStorageKey,
  type Side,
  type SidePanelCtxValue,
} from "./sidepanel-internals.js";

function readInitialCollapsed(
  id: string,
  defaultCollapsed: boolean,
): boolean {
  try {
    const raw = localStorage.getItem(itemCollapsedStorageKey(id));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* localStorage may be blocked */
  }
  return defaultCollapsed;
}

interface DiscoveredItem {
  id: string;
  defaultCollapsed: boolean;
  element: ReactElement<SidePanelItemProps>;
}

function discoverItems(children: ReactNode): DiscoveredItem[] {
  const out: DiscoveredItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type !== SidePanelItem) return;
    const props = child.props as SidePanelItemProps;
    out.push({
      id: props.id,
      defaultCollapsed: props.defaultCollapsed ?? false,
      element: child as ReactElement<SidePanelItemProps>,
    });
  });
  return out;
}

export interface SidePanelProps {
  /** Stack of SidePanelItem children. */
  children: ReactNode;
  /** Side affects layout direction + splitter orientation:
   *   left/right → vertical stack, horizontal splitters
   *   bottom     → horizontal stack, vertical splitters
   */
  side?: Side;
  className?: string;
}

export function SidePanel({
  children,
  side = "left",
  className,
}: SidePanelProps) {
  const items = useMemo(() => discoverItems(children), [children]);

  // Initialize collapsed state map from localStorage. After first render
  // each SidePanelItem will push updates back into this map via
  // `reportCollapsed` (called from its persist effect), so the panel
  // stays in sync.
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const it of items) {
        init[it.id] = readInitialCollapsed(it.id, it.defaultCollapsed);
      }
      return init;
    },
  );

  const ctxValue = useMemo<SidePanelCtxValue>(
    () => ({
      side,
      reportCollapsed: (id, collapsed) =>
        setCollapsedById((prev) =>
          prev[id] === collapsed ? prev : { ...prev, [id]: collapsed },
        ),
    }),
    [side],
  );

  // Compute which items are expanded + which one is the FIRST expanded
  // (the grower). All other expanded items are explicitly sized via
  // CSS vars written by the trailing Splitter on the item above them.
  // When all items are collapsed the panel renders as a stack of
  // headers — fine, nothing to grow.
  const expandedIds = useMemo(
    () => items.filter((it) => !collapsedById[it.id]).map((it) => it.id),
    [items, collapsedById],
  );
  const firstExpandedId = expandedIds[0];

  const isHorizontal = side === "bottom";
  const cssVarBase = `--sp-${side}`;
  const sizeFallback = isHorizontal ? 300 : 200;

  // Build the rendered sequence: each item, optionally followed by a
  // Splitter that controls the NEXT expanded item's size. The splitter
  // is "invert" because dragging it INTO the next item shrinks that
  // item (its size var goes down).
  const segments: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const expanded = !collapsedById[it.id];
    const isGrower = it.id === firstExpandedId;

    let flexValue: CSSProperties["flex"];
    if (!expanded) {
      // Collapsed → just the header height/width.
      flexValue = "0 0 auto";
    } else if (isGrower) {
      // The grower — absorbs leftover space.
      flexValue = "1 1 0";
    } else {
      // Sized via CSS var written by the splitter above this item.
      flexValue = `0 0 var(${cssVarBase}-${it.id}-px, ${sizeFallback}px)`;
    }

    segments.push(
      <div
        key={`item:${it.id}`}
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flex: flexValue }}
      >
        {it.element}
      </div>,
    );

    // Render a splitter AFTER this expanded item if there's a later
    // expanded sibling. The splitter writes the size for that next
    // expanded item (which is therefore sized, not the grower).
    if (expanded) {
      const nextExpandedId = expandedIds[expandedIds.indexOf(it.id) + 1];
      if (nextExpandedId) {
        segments.push(
          <Splitter
            key={`split:${it.id}->${nextExpandedId}`}
            orientation={isHorizontal ? "vertical" : "horizontal"}
            cssVar={`${cssVarBase}-${nextExpandedId}-px`}
            storageKey={`catalyst-llm-sdk:sidepanel:${side}:${nextExpandedId}:size`}
            defaultPx={sizeFallback}
            minPx={isHorizontal ? 200 : 80}
            maxPx={isHorizontal ? 1200 : 800}
            invert
            style={
              isHorizontal
                ? { width: 6, flex: "0 0 6px", alignSelf: "stretch" }
                : { height: 6, flex: "0 0 6px", alignSelf: "stretch" }
            }
          />,
        );
      }
    }
  }

  return (
    <SidePanelCtx.Provider value={ctxValue}>
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 gap-1 p-2",
          isHorizontal ? "flex-row overflow-x-auto" : "flex-col overflow-y-auto",
          className,
        )}
        data-side={side}
      >
        {segments}
      </div>
    </SidePanelCtx.Provider>
  );
}
