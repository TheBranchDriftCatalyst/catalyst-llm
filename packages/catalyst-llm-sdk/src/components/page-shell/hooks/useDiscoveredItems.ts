import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  SidePanelItem,
  type SidePanelItemProps,
} from "../SidePanelItem.js";

export interface DiscoveredItem {
  id: string;
  defaultCollapsed: boolean;
  element: ReactElement<SidePanelItemProps>;
}

/**
 * Walk a SidePanel's `children` and pull each rail item's metadata
 * out so the panel can drive layout (sizing flex, splitter
 * placement, collapsed registry) without re-rendering on every walk.
 *
 * Two child shapes are recognised:
 *   1. `<SidePanelItem id="..." defaultCollapsed={...}>` — direct.
 *   2. Function components that carry a static `itemId` (and optional
 *      `defaultCollapsed`) field — pages compose rail items as
 *      reusable wrappers without losing discoverability.
 */
export function useDiscoveredItems(children: ReactNode): DiscoveredItem[] {
  return useMemo(() => {
    const out: DiscoveredItem[] = [];
    const visit = (node: ReactNode): void => {
      Children.forEach(node, (child) => {
        if (!isValidElement(child)) return;
        if (child.type === Fragment) {
          visit((child.props as { children?: ReactNode }).children);
          return;
        }
        if (child.type === SidePanelItem) {
          const props = child.props as SidePanelItemProps;
          out.push({
            id: props.id,
            defaultCollapsed: props.defaultCollapsed ?? false,
            element: child as ReactElement<SidePanelItemProps>,
          });
          return;
        }
        const t = child.type as
          | { itemId?: string; defaultCollapsed?: boolean }
          | string;
        if (
          typeof t === "function" &&
          typeof (t as { itemId?: string }).itemId === "string"
        ) {
          const meta = t as { itemId: string; defaultCollapsed?: boolean };
          out.push({
            id: meta.itemId,
            defaultCollapsed: meta.defaultCollapsed ?? false,
            element: child as ReactElement<SidePanelItemProps>,
          });
        }
      });
    };
    visit(children);
    return out;
  }, [children]);
}
