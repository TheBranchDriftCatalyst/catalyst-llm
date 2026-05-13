/**
 * Internal context + helpers shared between SidePanel and SidePanelItem
 * — extracted into a third module to avoid a circular import (SidePanel
 * needs SidePanelItem's class identity for child discovery; SidePanelItem
 * needs the report hook to push collapsed state up).
 */
import { createContext, useContext } from "react";

export type Side = "left" | "right" | "bottom";

export interface SidePanelCtxValue {
  side: Side;
  reportCollapsed: (id: string, collapsed: boolean) => void;
}

export const SidePanelCtx = createContext<SidePanelCtxValue | null>(null);

const noop = () => {};

/** Returns the parent SidePanel's collapsed-state reporter, or a no-op
 * when used outside of one (e.g. SidePanelItem in storybook / tests). */
export function useSidePanelReport(): (id: string, collapsed: boolean) => void {
  const ctx = useContext(SidePanelCtx);
  return ctx?.reportCollapsed ?? noop;
}

export function itemCollapsedStorageKey(id: string): string {
  return `catalyst-llm-sdk:sidepanel-item:${id}:collapsed`;
}
