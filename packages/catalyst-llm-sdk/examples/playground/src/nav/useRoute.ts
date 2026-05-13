/**
 * Tiny pushState router. Reads paths from the page registry so
 * adding a new tab is a one-file change in pages/. Listens for
 * back/forward via popstate and reflects tab switches into the URL
 * bar so links and refreshes are deep-linkable.
 *
 * The first page in PAGES is the default — `/` redirects to its
 * path on mount. If the operator deep-links to a path whose page is
 * filtered out (e.g. /stats in a prod build that doesn't ship
 * StatsView), useRoute resolves to the default tab.
 */
import { useEffect, useMemo, useState } from "react";
import { PAGES } from "../pages/index.js";
import type { PageId } from "../pages/types.js";

export type { PageId } from "../pages/types.js";

function buildPathMap(): {
  pathToId: Map<string, PageId>;
  idToPath: Map<PageId, string>;
  defaultId: PageId;
  defaultPath: string;
} {
  const pathToId = new Map<string, PageId>();
  const idToPath = new Map<PageId, string>();
  for (const p of PAGES) {
    pathToId.set(p.path, p.id);
    idToPath.set(p.id, p.path);
  }
  const first = PAGES[0];
  if (!first) {
    throw new Error("pages registry is empty — at least one page is required");
  }
  return {
    pathToId,
    idToPath,
    defaultId: first.id,
    defaultPath: first.path,
  };
}

export function useRoute(): [PageId, (p: PageId) => void] {
  const { pathToId, idToPath, defaultId, defaultPath } = useMemo(
    buildPathMap,
    [],
  );

  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Normalize "/" → default page once on mount so future refreshes
  // deep-link cleanly.
  useEffect(() => {
    if (path === "/") {
      window.history.replaceState({}, "", defaultPath);
      setPath(defaultPath);
    }
  }, [path, defaultPath]);

  const navigate = (p: PageId) => {
    const url = idToPath.get(p) ?? defaultPath;
    if (window.location.pathname !== url) {
      window.history.pushState({}, "", url);
      setPath(url);
    }
  };

  const id = pathToId.get(path) ?? defaultId;
  return [id, navigate];
}
