/**
 * Compact tabular view of a compare run — one row per model, sortable
 * by ttft / tok-per-sec / latency / cost / output tokens. Each row
 * expands inline to show the full response (vs. the side-by-side
 * column view, which fits ~3 models on screen at once).
 */
import { useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import type { ModelWithRouting } from "../../client/index.js";
import {
  formatMs,
  formatRate,
  formatTokens,
  formatUsd,
} from "../../react/useChatCost.js";
import type { CompareRun } from "../../react/useCompare.js";
import { RenderedContent } from "../shared/RenderedContent.js";
import {
  checkJson,
  statsForRun,
  type PerRunStats,
} from "./compare-stats.js";
import { JsonBadge } from "./compare-stats-ui.js";
import { cn } from "../shared/utils.js";

export interface ResultsTableProps {
  modelIds: string[];
  runs: Record<string, CompareRun>;
  models: ModelWithRouting[];
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  sortBy: "model" | "ttft" | "tokps" | "rt" | "cost" | "out";
  sortDir: "asc" | "desc";
  onSort: (col: ResultsTableProps["sortBy"]) => void;
  onRemove: (id: string) => void;
}

export function ResultsTable({
  modelIds,
  runs,
  models,
  expandedRow,
  setExpandedRow,
  sortBy,
  sortDir,
  onSort,
  onRemove,
}: ResultsTableProps) {
  const rows = useMemo(() => {
    const rs = modelIds.map((id) => {
      const run = runs[id];
      const model = models.find((m) => m.id === id);
      const stats = run ? statsForRun(run, model) : null;
      return { id, run, model, stats };
    });
    const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
      const aN = a ?? Infinity;
      const bN = b ?? Infinity;
      return aN === bN ? 0 : aN < bN ? -1 : 1;
    };
    const sorted = [...rs].sort((a, b) => {
      switch (sortBy) {
        case "model":
          return a.id.localeCompare(b.id);
        case "ttft":
          return cmpNum(a.stats?.ttftMs, b.stats?.ttftMs);
        case "tokps":
          // higher tok/s is "better"; sort desc by default semantics
          return cmpNum(
            a.stats?.tokensPerSec ? -a.stats.tokensPerSec : null,
            b.stats?.tokensPerSec ? -b.stats.tokensPerSec : null,
          );
        case "rt":
          return cmpNum(a.stats?.latencyMs, b.stats?.latencyMs);
        case "cost":
          return cmpNum(a.stats?.cost, b.stats?.cost);
        case "out":
          return cmpNum(a.stats?.outputTokens, b.stats?.outputTokens);
      }
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [modelIds, runs, models, sortBy, sortDir]);

  function SortHeader({
    col,
    label,
    align = "left",
  }: {
    col: ResultsTableProps["sortBy"];
    label: string;
    align?: "left" | "right";
  }) {
    const active = sortBy === col;
    return (
      <th
        className={cn(
          "cursor-pointer select-none px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground",
          align === "right" && "text-right",
        )}
        onClick={() => onSort(col)}
      >
        {label}
        {active && (
          <span className="ml-1 opacity-70">
            {sortDir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </th>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
            <tr>
              <th className="w-8" />
              <SortHeader col="model" label="model" />
              <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                response
              </th>
              <SortHeader col="out" label="out" align="right" />
              <SortHeader col="ttft" label="ttft" align="right" />
              <SortHeader col="tokps" label="tok/s" align="right" />
              <SortHeader col="rt" label="rt" align="right" />
              <SortHeader col="cost" label="cost" align="right" />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, run, model, stats }) => {
              const expanded = expandedRow === id;
              return (
                <FragmentRow
                  key={id}
                  id={id}
                  run={run}
                  model={model}
                  stats={stats}
                  expanded={expanded}
                  onToggle={() => setExpandedRow(expanded ? null : id)}
                  onRemove={() => onRemove(id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  id,
  run,
  model,
  stats,
  expanded,
  onToggle,
  onRemove,
}: {
  id: string;
  run: CompareRun | undefined;
  model: ModelWithRouting | undefined;
  stats: PerRunStats | null;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const text = run?.text ?? "";
  const preview = text.length > 160 ? text.slice(0, 160) + "…" : text;
  const jsonCheck = checkJson(text, run?.isStreaming ?? false);
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b border-border/40 hover:bg-accent/20",
          run?.error && "bg-destructive/5",
          expanded && "bg-accent/20",
        )}
        onClick={onToggle}
      >
        <td className="px-2 py-1.5 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-2 py-1.5 font-mono">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="truncate max-w-[200px]">{id}</span>
            {run?.isStreaming && (
              <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold uppercase text-primary">
                streaming
              </span>
            )}
            {run?.error && (
              <span className="rounded-sm bg-destructive/15 px-1 text-[9px] font-bold uppercase text-destructive">
                error
              </span>
            )}
            <JsonBadge check={jsonCheck} />
          </div>
          {model?.metadata?.litellm_provider && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {model.metadata.litellm_provider}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground">
          <div className="line-clamp-1 max-w-[480px] font-sans text-[11px]">
            {run?.error ? run.error : preview || "—"}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatTokens(stats.outputTokens) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatMs(stats.ttftMs) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatRate(stats.tokensPerSec) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatMs(stats.latencyMs) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-primary">
          {stats ? formatUsd(stats.cost) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label={`Remove ${id} from comparison`}
            title={`Remove ${id} from comparison`}
            className="text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-card/40">
          <td />
          <td colSpan={8} className="px-3 py-3">
            {run?.error ? (
              <pre
                role="alert"
                className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-destructive"
              >
                {run.error}
              </pre>
            ) : run?.text ? (
              <RenderedContent
                content={run.text}
                isStreaming={run?.isStreaming}
                className="text-[12px] leading-relaxed"
              />
            ) : (
              <span className="italic text-muted-foreground">—</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
