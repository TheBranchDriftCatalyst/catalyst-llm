/**
 * Stats tab — dev-only DuckDB-WASM chart surface. The component is
 * gated behind a lazy import + the `devOnly: true` meta flag so the
 * DuckDB payload (~10 MB) only lands when a dev actually clicks the
 * /stats tab — never in a production bundle.
 *
 * In a prod build (`!import.meta.env.DEV`) the registry filters this
 * page out entirely and deep links to /stats fall back to /chat
 * (see useRoute.ts).
 */
import { Suspense, lazy, type ComponentType } from "react";
import { Database } from "lucide-react";
import type { PageMeta, PageProps } from "./types.js";

const LazyStatsView: ComponentType = import.meta.env.DEV
  ? lazy(() =>
      import("@catalyst/llm-sdk/dev").then((m) => ({ default: m.StatsView })),
    )
  : () => null;

export function StatsPage(_props: PageProps) {
  return (
    <main id="main-content" className="flex-1 overflow-hidden">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading DuckDB-WASM…
          </div>
        }
      >
        <LazyStatsView />
      </Suspense>
    </main>
  );
}

export const statsPageMeta: PageMeta = {
  id: "stats",
  label: "Stats",
  icon: Database,
  path: "/stats",
  devOnly: true,
  component: StatsPage,
};
