/**
 * SidePanelItem — collapsible section within a SidePanel.
 *
 * One header (clickable to collapse/expand) + a body that holds the
 * item's content. Collapsed state persists per `storageKey` so the
 * operator's preferred fold-out doesn't reset on refresh.
 *
 * Items adapt their flex behaviour to the side they're in: in
 * left/right (vertical stack), items grow to fill the panel when only
 * one is expanded, but a `defaultGrow` prop lets the operator decide
 * which item gets the slack when multiple are expanded.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../utils.js";

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
   * panel (e.g. the agents list) so siblings stay compact. */
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

function storageKey(id: string): string {
  return `catalyst-llm-sdk:sidepanel-item:${id}:collapsed`;
}

export function SidePanelItem({
  id,
  title,
  icon,
  defaultCollapsed = false,
  defaultGrow = false,
  headerRight,
  openSignal,
  children,
  className,
}: SidePanelItemProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey(id));
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      /* localStorage blocked */
    }
    return defaultCollapsed;
  });
  const persistedRef = useRef<boolean>(collapsed);

  useEffect(() => {
    if (persistedRef.current === collapsed) return;
    persistedRef.current = collapsed;
    try {
      localStorage.setItem(storageKey(id), collapsed ? "1" : "0");
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

  return (
    <section
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-md border border-border/60 bg-card/30",
        !collapsed && defaultGrow && "min-h-0 flex-1",
        className,
      )}
      data-collapsed={collapsed || undefined}
    >
      <header
        className="flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
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
