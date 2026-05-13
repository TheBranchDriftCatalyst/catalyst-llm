/**
 * Tiny pushState router — five routes, zero deps. Listens for
 * back/forward via popstate and reflects tab switches into the URL
 * bar so links and refreshes are deep-linkable.
 *
 * `/stats` is dev-only — in a prod build (where `import.meta.env.DEV`
 * is false) the page registry filters it out and a deep link to
 * /stats falls back to /chat.
 */
import { useEffect, useState } from "react";

export type Page = "chat" | "compare" | "prompts" | "engine" | "stats";

const PATH_TO_PAGE: Record<string, Page> = {
  "/": "chat",
  "/chat": "chat",
  "/compare": "compare",
  "/prompts": "prompts",
  "/engine": "engine",
  "/stats": "stats",
};

function pageFromPath(path: string): Page {
  const p = PATH_TO_PAGE[path] ?? "chat";
  // Defensive: if someone deep-links to /stats in a prod build that
  // doesn't ship StatsView, fall back to chat instead of a blank page.
  if (p === "stats" && !import.meta.env.DEV) return "chat";
  return p;
}

function pathFromPage(page: Page): string {
  if (page === "compare") return "/compare";
  if (page === "prompts") return "/prompts";
  if (page === "engine") return "/engine";
  if (page === "stats") return "/stats";
  return "/chat";
}

export function useRoute(): [Page, (p: Page) => void] {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Normalize "/" → "/chat" once on mount so future refreshes deep-link cleanly.
  useEffect(() => {
    if (path === "/") {
      const url = "/chat";
      window.history.replaceState({}, "", url);
      setPath(url);
    }
  }, [path]);

  const navigate = (p: Page) => {
    const url = pathFromPage(p);
    if (window.location.pathname !== url) {
      window.history.pushState({}, "", url);
      setPath(url);
    }
  };

  return [pageFromPath(path), navigate];
}
