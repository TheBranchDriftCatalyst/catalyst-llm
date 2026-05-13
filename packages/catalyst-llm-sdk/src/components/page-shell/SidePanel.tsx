/* Stack of SidePanelItems inside a PageShell rail.
 * - Items collapse upward (header sits at the top, content folds below).
 * - Adjacent expanded items get a Splitter between them (resize heights).
 * - Optional cross-rail + same-rail reorder via HTML5 drag/drop.
 */
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Splitter } from "./Splitter.js";
import { cn } from "../utils.js";
import {
  SIDEPANEL_ITEM_DND_TYPE,
  SidePanelCtx,
  type Side,
  type SidePanelCtxValue,
} from "./sidepanel-internals.js";
import { useCollapsedRegistry } from "./hooks/useCollapsedRegistry.js";
import { useDiscoveredItems } from "./hooks/useDiscoveredItems.js";

export interface SidePanelProps {
  children: ReactNode;
  side?: Side;
  /** Cross-rail + within-rail move. beforeId names the item to insert
   * the dragged item BEFORE; null = append to the end of toSide. */
  onItemMove?: (
    itemId: string,
    toSide: Side,
    beforeId: string | null,
  ) => void;
  className?: string;
}

export function SidePanel({
  children,
  side = "left",
  onItemMove,
  className,
}: SidePanelProps) {
  const items = useDiscoveredItems(children);
  const { collapsedById, reportCollapsed } = useCollapsedRegistry(items);

  const draggable = Boolean(onItemMove);
  const ctxValue = useMemo<SidePanelCtxValue>(
    () => ({ side, reportCollapsed, draggable }),
    [side, draggable, reportCollapsed],
  );

  // ─ Drag/drop with insertion-target hit-testing ───────────────────
  // When the operator drags a SidePanelItem header over this panel,
  // we hit-test the cursor against each item's section element to
  // figure out where the drop should insert. Top half of an item =
  // insert BEFORE it; bottom half = insert AFTER (= before the next
  // item, or null = append). A horizontal indicator line renders at
  // the insertion position so the operator can see where it'll land.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dropState, setDropState] = useState<{
    active: boolean;
    /** Item id to insert BEFORE. null = append to end of this rail. */
    beforeId: string | null;
    /** Y position (relative to panel content) of the indicator line. */
    indicatorY: number;
  }>({ active: false, beforeId: null, indicatorY: 0 });

  const computeInsertion = (
    e: DragEvent<HTMLDivElement>,
  ): { beforeId: string | null; indicatorY: number } => {
    const panel = panelRef.current;
    if (!panel) return { beforeId: null, indicatorY: 0 };
    const itemEls = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-sidepanel-item]"),
    );
    if (itemEls.length === 0) {
      return { beforeId: null, indicatorY: 0 };
    }
    const panelRect = panel.getBoundingClientRect();
    const cursorY = e.clientY;
    // Find the first item whose VERTICAL midpoint is below the cursor —
    // that's the one we'd insert before.
    for (const el of itemEls) {
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (cursorY < mid) {
        const id = el.getAttribute("data-sidepanel-item")!;
        return {
          beforeId: id,
          indicatorY: r.top - panelRect.top + panel.scrollTop,
        };
      }
    }
    // Cursor is below every item's midpoint → append to end.
    const lastRect = itemEls[itemEls.length - 1].getBoundingClientRect();
    return {
      beforeId: null,
      indicatorY: lastRect.bottom - panelRect.top + panel.scrollTop,
    };
  };

  const handleDragOver = onItemMove
    ? (e: DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes(SIDEPANEL_ITEM_DND_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const next = computeInsertion(e);
        setDropState((prev) =>
          prev.active &&
          prev.beforeId === next.beforeId &&
          prev.indicatorY === next.indicatorY
            ? prev
            : { active: true, ...next },
        );
      }
    : undefined;
  const handleDragLeave = onItemMove
    ? (e: DragEvent<HTMLDivElement>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropState((s) => (s.active ? { ...s, active: false } : s));
      }
    : undefined;
  const handleDrop = onItemMove
    ? (e: DragEvent<HTMLDivElement>) => {
        const itemId = e.dataTransfer.getData(SIDEPANEL_ITEM_DND_TYPE);
        // Compute insertion FRESH from the cursor here — don't rely on
        // dropState set during dragover, because React batches that
        // state update and the drop handler closure may see the stale
        // initial value (especially under synthetic event dispatch in
        // tests where dragover + drop fire in the same tick).
        const fresh = computeInsertion(e);
        setDropState({ active: false, beforeId: null, indicatorY: 0 });
        if (!itemId) return;
        e.preventDefault();
        onItemMove(itemId, side, fresh.beforeId);
      }
    : undefined;

  const expandedIds = useMemo(
    () => items.filter((it) => !collapsedById[it.id]).map((it) => it.id),
    [items, collapsedById],
  );
  const firstExpandedId = expandedIds[0];

  const cssVarBase = `--sp-${side}`;
  const sizeFallback = 200;
  // CSS custom property names must be valid CSS identifiers — dots
  // aren't allowed (var(--sp-left-engine.events-px) is a syntax error
  // and never resolves). Item ids commonly contain dots
  // (e.g. "engine.test-run"), so sanitize them here for the CSS var
  // name only; storage keys keep the original id.
  const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

  const segments: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const expanded = !collapsedById[it.id];
    const isGrower = it.id === firstExpandedId;

    let flexValue: CSSProperties["flex"];
    if (!expanded) flexValue = "0 0 auto";
    else if (isGrower) flexValue = "1 1 0";
    else
      flexValue = `0 0 var(${cssVarBase}-${sanitize(it.id)}-px, ${sizeFallback}px)`;

    segments.push(
      <div
        key={`item:${it.id}`}
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flex: flexValue }}
      >
        {it.element}
      </div>,
    );

    if (expanded) {
      const nextExpandedId = expandedIds[expandedIds.indexOf(it.id) + 1];
      if (nextExpandedId) {
        segments.push(
          <Splitter
            key={`split:${it.id}->${nextExpandedId}`}
            orientation="horizontal"
            cssVar={`${cssVarBase}-${sanitize(nextExpandedId)}-px`}
            storageKey={`catalyst-llm-sdk:sidepanel:${side}:${nextExpandedId}:size`}
            defaultPx={sizeFallback}
            minPx={80}
            maxPx={800}
            invert
            style={{ height: 6, flex: "0 0 6px", alignSelf: "stretch" }}
          />,
        );
      }
    }
  }

  return (
    <SidePanelCtx.Provider value={ctxValue}>
      <div
        ref={panelRef}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1",
          dropState.active && "ring-2 ring-inset ring-primary/40",
          className,
        )}
        data-side={side}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {segments}
        {/* Drop-insertion indicator — absolute-positioned 2px line at
         * the Y where the dragged item will land. */}
        {dropState.active && (
          <div
            aria-hidden="true"
            data-drop-indicator
            className="pointer-events-none absolute left-1 right-1 z-10 h-0.5 bg-primary shadow-[0_0_8px_var(--primary)]"
            style={{ top: dropState.indicatorY }}
          />
        )}
      </div>
    </SidePanelCtx.Provider>
  );
}
