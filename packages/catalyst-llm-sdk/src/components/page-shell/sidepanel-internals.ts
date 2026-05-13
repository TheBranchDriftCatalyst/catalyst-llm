/**
 * Internal context + helpers shared between SidePanel and SidePanelItem
 * — extracted into a third module to avoid a circular import (SidePanel
 * needs SidePanelItem's class identity for child discovery; SidePanelItem
 * needs the report hook to push collapsed state up).
 */
import { createContext, useContext } from "react";

export type Side = "left" | "right" | "bottom";

/** MIME-ish type id we use for HTML5 drag-and-drop of SidePanelItems
 * between rails. Lowercase per the DataTransfer convention. */
export const SIDEPANEL_ITEM_DND_TYPE =
  "application/x-catalyst-sidepanel-item";

export interface SidePanelCtxValue {
  side: Side;
  reportCollapsed: (id: string, collapsed: boolean) => void;
  /** True when this SidePanel parent accepts cross-rail moves — gates
   * the drag handle's visibility on the item header. */
  draggable: boolean;
}

export const SidePanelCtx = createContext<SidePanelCtxValue | null>(null);

const noop = () => {};

/** Returns the parent SidePanel's collapsed-state reporter, or a no-op
 * when used outside of one (e.g. SidePanelItem in storybook / tests). */
export function useSidePanelReport(): (id: string, collapsed: boolean) => void {
  const ctx = useContext(SidePanelCtx);
  return ctx?.reportCollapsed ?? noop;
}

/** Whether the parent SidePanel has cross-rail drag enabled. False when
 * SidePanelItem is used outside of a SidePanel (storybook / tests). */
export function useSidePanelDraggable(): boolean {
  const ctx = useContext(SidePanelCtx);
  return ctx?.draggable ?? false;
}

export function itemCollapsedStorageKey(id: string): string {
  return `catalyst-llm-sdk:sidepanel-item:${id}:collapsed`;
}
