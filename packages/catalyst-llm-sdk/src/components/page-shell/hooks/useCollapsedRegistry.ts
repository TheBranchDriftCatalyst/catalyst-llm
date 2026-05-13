import { useCallback, useState } from "react";
import { itemCollapsedStorageKey } from "../sidepanel-internals.js";
import type { DiscoveredItem } from "./useDiscoveredItems.js";

function readInitialCollapsed(id: string, defaultCollapsed: boolean): boolean {
  try {
    const raw = localStorage.getItem(itemCollapsedStorageKey(id));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* localStorage may be blocked */
  }
  return defaultCollapsed;
}

/**
 * Per-item collapsed/expanded state for a SidePanel rail. Hydrates
 * from localStorage on first render (per-id key), then keeps the
 * registry in memory; SidePanelItem reports its own state changes
 * via `reportCollapsed` and the registry decides flex behaviour.
 */
export function useCollapsedRegistry(items: DiscoveredItem[]) {
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const it of items) {
        init[it.id] = readInitialCollapsed(it.id, it.defaultCollapsed);
      }
      return init;
    },
  );

  const reportCollapsed = useCallback((id: string, collapsed: boolean) => {
    setCollapsedById((prev) =>
      prev[id] === collapsed ? prev : { ...prev, [id]: collapsed },
    );
  }, []);

  return { collapsedById, reportCollapsed };
}
