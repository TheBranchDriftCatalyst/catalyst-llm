/**
 * SidePanelItem — collapsible section within a SidePanel.
 *
 * One header (clickable to collapse/expand) + a body that holds the
 * item's content. Collapsed state persists per `storageKey` so the
 * operator's preferred fold-out doesn't reset on refresh.
 *
 * The parent SidePanel owns the layout: it places this section in a
 * flex parent and sizes the section via inline flex styles + Splitters
 * between adjacent expanded items. SidePanelItem itself is intentionally
 * size-agnostic — it just fills whatever box the parent gives it.
 */
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "../utils.js";
import {
  SIDEPANEL_ITEM_DND_TYPE,
  itemCollapsedStorageKey as itemCollapsedStorageKeyInternal,
  useSidePanelDraggable,
  useSidePanelReport,
} from "./sidepanel-internals.js";

export interface SidePanelItemProps {
  /** Stable id used to scope localStorage state (collapsed flag). */
  id: string;
  title: string;
  /** Optional icon (lucide component or any ReactNode) rendered next to
   * the title in the header strip. */
  icon?: ReactNode;
  /** Initial collapsed state when no persisted value exists. */
  defaultCollapsed?: boolean;
  /** When true and the item is expanded, the body claims `flex: 1` to
   * absorb leftover vertical space. Useful for "primary" items on a
   * panel (e.g. the agents list) so siblings stay compact.
   *
   * NOTE: SidePanel now drives sizing via Splitters — the LAST expanded
   * item in the panel is automatically the grower regardless of this
   * flag. The flag is kept for storybook/standalone use where there's
   * no parent SidePanel; in a SidePanel context it's ignored. */
  defaultGrow?: boolean;
  /** Right-aligned header content (badges, action buttons). */
  headerRight?: ReactNode;
  /** Imperative "force-expand" signal. When this value changes (e.g.
   * the parent increments a counter), the item flips to expanded
   * regardless of its current collapsed state. Useful for "clicking X
   * in the canvas should pop open the Y rail item". The item's own
   * collapse/expand interactions still work normally; this is just a
   * one-way notification. */
  openSignal?: number;
  /** The item body. Should size itself to its content; the wrapper
   * applies overflow + flex according to `defaultGrow`. */
  children: ReactNode;
  className?: string;
}

/** Re-export the storage-key helper for backwards-compatible imports. */
export const itemCollapsedStorageKey = itemCollapsedStorageKeyInternal;

export function SidePanelItem({
  id,
  title,
  icon,
  defaultCollapsed = false,
  headerRight,
  openSignal,
  children,
  className,
}: SidePanelItemProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(itemCollapsedStorageKey(id));
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      /* localStorage blocked */
    }
    return defaultCollapsed;
  });
  const persistedRef = useRef<boolean>(collapsed);

  // Notify the enclosing SidePanel (if any) about the current collapsed
  // state so it can recompute its flex/splitter layout. Safe outside a
  // SidePanel — the hook returns a no-op then.
  const reportCollapsed = useSidePanelReport();
  useEffect(() => {
    reportCollapsed(id, collapsed);
  }, [id, collapsed, reportCollapsed]);

  useEffect(() => {
    if (persistedRef.current === collapsed) return;
    persistedRef.current = collapsed;
    try {
      localStorage.setItem(itemCollapsedStorageKey(id), collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed, id]);

  // Watch the openSignal — every distinct value flips collapsed → false.
  // Ignore undefined (parent hasn't wired it) and the very first render
  // (we don't want a mount-time expand to overwrite the persisted state).
  const lastSignalRef = useRef<number | undefined>(openSignal);
  useEffect(() => {
    if (openSignal === undefined) return;
    if (lastSignalRef.current === openSignal) return;
    lastSignalRef.current = openSignal;
    setCollapsed(false);
  }, [openSignal]);

  // Cross-rail drag — only enabled when the parent SidePanel has
  // wired up `onItemMove`. The handle (and the section's dragging
  // visual state) are both gated on this.
  const draggable = useSidePanelDraggable();
  const [dragging, setDragging] = useState(false);
  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(SIDEPANEL_ITEM_DND_TYPE, id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };
  const handleDragEnd = () => setDragging(false);

  return (
    <section
      className={cn(
        "flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/60 bg-card/30",
        dragging && "opacity-40",
        className,
      )}
      data-collapsed={collapsed || undefined}
      data-sidepanel-item={id}
    >
      <header
        className="flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {/* Drag handle — only renders when the parent SidePanel allows
         * moves. The handle (NOT the header) carries draggable=true so
         * a normal header click still toggles collapse without
         * starting a drag. Stops click propagation so grabbing the
         * grip doesn't ALSO toggle collapse. Larger + always-visible
         * tint so the operator can find it on a busy header. */}
        {draggable && (
          <span
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "-ml-0.5 flex h-6 w-4 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/30 hover:text-foreground active:cursor-grabbing",
              dragging && "bg-primary/30 text-foreground",
            )}
            title="Drag to move (across rails or to reorder)"
            aria-label="Drag handle"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        {collapsed ? (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
        {icon && <span className="flex h-3 w-3 items-center">{icon}</span>}
        <span className="flex-1 truncate">{title}</span>
        {headerRight && (
          <span
            className="ml-auto"
            // Stop header-click collapse from firing when the operator
            // clicks an action button in the right slot.
            onClick={(e) => e.stopPropagation()}
          >
            {headerRight}
          </span>
        )}
      </header>
      {!collapsed && (
        <div className={cn("min-h-0 flex-1 overflow-y-auto")}>{children}</div>
      )}
    </section>
  );
}

