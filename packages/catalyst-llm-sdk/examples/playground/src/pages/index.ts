/**
 * Page registry — single source of truth for which tabs exist in the
 * playground, their order, paths, icons, and components. Header
 * iterates this to build the tab row; App.tsx resolves the active
 * page's component; useRoute reads `path` to power the URL router.
 *
 * Adding a new page: create a PageMeta in its own file and append to
 * PAGES. The Header + router pick it up automatically.
 */
import { chatPageMeta } from "./ChatPage.js";
import { comparePageMeta } from "./ComparePage.js";
import { promptsPageMeta } from "./PromptsPage.js";
import { enginePageMeta } from "./EnginePage.js";
import { statsPageMeta } from "./StatsPage.js";
import type { PageMeta, PageId } from "./types.js";

const ALL_PAGES: readonly PageMeta[] = [
  chatPageMeta,
  comparePageMeta,
  promptsPageMeta,
  enginePageMeta,
  statsPageMeta,
];

/** Pages enabled in the current build — `devOnly` entries are
 * filtered out of prod bundles. Header + router both read from this. */
export const PAGES: readonly PageMeta[] = ALL_PAGES.filter(
  (p) => !p.devOnly || import.meta.env.DEV,
);

export function pageById(id: PageId): PageMeta | undefined {
  return PAGES.find((p) => p.id === id);
}

export type { PageMeta, PageId, PageProps } from "./types.js";
