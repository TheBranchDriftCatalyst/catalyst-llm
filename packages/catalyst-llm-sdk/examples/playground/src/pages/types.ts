/**
 * Page-registry shape. Every tab in the playground declares a
 * PageMeta — the Header iterates the registry to build its tab row,
 * App.tsx resolves the active page's component, and useRoute reads
 * `path` from the registry instead of hard-coded maps.
 *
 * Optional `useStreamingIndicator` runs in the Header to surface
 * cross-tab "stream in flight" dots; pages without live work omit it.
 * `devOnly: true` filters the page out of prod builds at registry
 * read time.
 */
import type { ComponentType, ElementType } from "react";

export type PageId = "chat" | "compare" | "prompts" | "engine" | "stats";

export interface PageProps {
  /** Cross-tab navigation hook — `onNavigate("compare")` switches to
   * the Compare tab. Optional; pages that don't need it ignore. */
  onNavigate?: (to: PageId) => void;
}

export interface PageMeta {
  id: PageId;
  label: string;
  icon: ElementType;
  path: string;
  /** Filtered out when `!import.meta.env.DEV`. */
  devOnly?: boolean;
  /** Optional hook the Header calls to drive a streaming pulse dot on
   * the tab — used by Chat (any chat is streaming) and Compare (any
   * compare run is streaming). */
  useStreamingIndicator?: () => boolean;
  component: ComponentType<PageProps>;
}
