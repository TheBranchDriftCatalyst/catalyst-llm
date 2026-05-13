/**
 * Bar-chart subview of CompareView. Renders one chart per relevant
 * metric — each chart shows the currently-selected models stacked
 * vertically, sorted best→worst, with a coloured horizontal bar
 * per model.
 *
 * Charts are hand-rolled SVG (no charting lib) — the data sets are
 * small (≤ a dozen models) and the visual vocabulary matches the
 * rest of the playground (synthwave palette, mono numerics). The
 * fixed width of 100% + responsive viewBox keeps them readable on
 * any breakpoint.
 *
 * Direction conventions: "lower is better" charts (TTFT, latency,
 * cost) are sorted ascending — short bar means winning model. "Higher
 * is better" charts (tokens/sec, output tokens) sort descending so
 * the longest bar is at the top.
 */
import { useMemo } from "react";
import { Trophy } from "lucide-react";
import type { CompareRun } from "../../react/useCompare.js";
import { cn } from "../utils.js";

export interface CompareGraphsProps {
  /** Model ids that are currently selected for comparison. */
  selectedIds: string[];
  /** Map from model id → CompareRun (the same shape useCompareStore exposes). */
  runs: Record<string, CompareRun>;
  className?: string;
}

interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  /** "lower is better" or "higher is better" controls sort + winner highlight. */
  direction: "lower" | "higher";
  /** Pull a numeric value out of a run; return null when the metric isn't
   * available (the bar is rendered as empty placeholder). */
  pick: (run: CompareRun | undefined) => number | null;
  /** How to format the trailing label on each row. */
  format: (n: number) => string;
}

const METRICS: MetricSpec[] = [
  {
    key: "ttft",
    label: "TTFT (time to first token)",
    unit: "ms",
    direction: "lower",
    pick: (r) =>
      r?.firstTokenTime && r?.streamStartTime
        ? r.firstTokenTime - r.streamStartTime
        : null,
    format: (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`),
  },
  {
    key: "tokps",
    label: "Tokens / second",
    unit: "tok/s",
    direction: "higher",
    pick: (r) => {
      const completion = r?.meta?.usage?.completion_tokens;
      if (!completion || !r?.firstTokenTime || !r?.streamEndTime) return null;
      const dur = (r.streamEndTime - r.firstTokenTime) / 1000;
      return dur > 0 ? completion / dur : null;
    },
    format: (n) => `${n.toFixed(1)} tok/s`,
  },
  {
    key: "duration",
    label: "Total duration",
    unit: "ms",
    direction: "lower",
    pick: (r) =>
      r?.streamEndTime && r?.streamStartTime
        ? r.streamEndTime - r.streamStartTime
        : null,
    format: (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`),
  },
  {
    key: "tokens-out",
    label: "Output tokens",
    unit: "tokens",
    direction: "higher",
    pick: (r) => r?.meta?.usage?.completion_tokens ?? null,
    format: (n) => n.toLocaleString(),
  },
  {
    key: "tokens-in",
    label: "Input tokens",
    unit: "tokens",
    direction: "higher",
    pick: (r) => r?.meta?.usage?.prompt_tokens ?? null,
    format: (n) => n.toLocaleString(),
  },
];

export function CompareGraphs({
  selectedIds,
  runs,
  className,
}: CompareGraphsProps) {
  const hasAnyData = useMemo(
    () => selectedIds.some((id) => runs[id] && !runs[id].isStreaming),
    [selectedIds, runs],
  );

  if (selectedIds.length === 0) {
    return (
      <Empty
        title="No models selected"
        body="Pick models in the bar above and run a prompt to populate these charts."
      />
    );
  }
  if (!hasAnyData) {
    return (
      <Empty
        title="Waiting for completions"
        body={
          selectedIds.some((id) => runs[id]?.isStreaming)
            ? "At least one run is still streaming. Charts populate once a model finishes."
            : "Send a prompt to start runs — charts appear when the first one completes."
        }
      />
    );
  }

  return (
    <div className={cn("grid gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {METRICS.map((m) => (
        <MetricChart key={m.key} metric={m} selectedIds={selectedIds} runs={runs} />
      ))}
    </div>
  );
}

function MetricChart({
  metric,
  selectedIds,
  runs,
}: {
  metric: MetricSpec;
  selectedIds: string[];
  runs: Record<string, CompareRun>;
}) {
  const rows = useMemo(() => {
    const data = selectedIds.map((id) => {
      const run = runs[id];
      const value = metric.pick(run);
      return { id, value, isStreaming: !!run?.isStreaming, error: !!run?.error };
    });
    // Sort: rows with values first, in the metric's preferred order.
    // Null (no data yet) and errored rows fall to the bottom but stay
    // visible so the user can see WHICH models still owe a result.
    return data.sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return metric.direction === "lower" ? a.value - b.value : b.value - a.value;
    });
  }, [metric, selectedIds, runs]);

  const max = useMemo(() => {
    let m = 0;
    for (const r of rows) if (r.value !== null && r.value > m) m = r.value;
    return m || 1;
  }, [rows]);

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold text-primary">{metric.label}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          {metric.direction === "lower" ? "lower is better" : "higher is better"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <BarRow
            key={r.id}
            label={r.id}
            value={r.value}
            max={max}
            format={metric.format}
            isWinner={i === 0 && r.value !== null}
            isStreaming={r.isStreaming}
            isError={r.error}
            direction={metric.direction}
          />
        ))}
      </ul>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  format,
  isWinner,
  isStreaming,
  isError,
  direction,
}: {
  label: string;
  value: number | null;
  max: number;
  format: (n: number) => string;
  isWinner: boolean;
  isStreaming: boolean;
  isError: boolean;
  direction: "lower" | "higher";
}) {
  const pct = value !== null ? (value / max) * 100 : 0;
  // For "lower is better" metrics, invert the visual: short bars look
  // like wins, but the eye reads "more bar = more good". To stay
  // consistent we flip the bar color on a lower-is-better row so the
  // winning value (smallest bar) gets the same prized cyan, and worse
  // values trend toward muted.
  const tone = isError
    ? "bg-destructive/70"
    : isStreaming
    ? "bg-primary/30 animate-pulse"
    : isWinner
    ? "bg-primary"
    : direction === "lower"
    ? "bg-primary/40"
    : "bg-primary/60";
  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span
        className={cn(
          "w-32 shrink-0 truncate font-mono",
          isWinner ? "text-primary" : "text-muted-foreground",
        )}
        title={label}
      >
        {isWinner && <Trophy className="mr-1 inline h-3 w-3 align-text-bottom" aria-hidden="true" />}
        {label}
      </span>
      <div className="relative flex-1">
        <div
          className={cn(
            "h-3.5 rounded-sm transition-[width] duration-300",
            tone,
          )}
          style={{ width: value === null ? "2%" : `${Math.max(2, pct)}%` }}
          aria-label={value === null ? "no data" : format(value)}
        />
      </div>
      <span
        className={cn(
          "w-20 shrink-0 text-right font-mono tabular-nums",
          isWinner ? "text-primary" : "text-muted-foreground",
        )}
      >
        {value === null
          ? isError
            ? "error"
            : isStreaming
            ? "streaming…"
            : "—"
          : format(value)}
      </span>
    </li>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="max-w-md space-y-2">
        <Trophy className="mx-auto h-8 w-8 opacity-30" aria-hidden="true" />
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-xs">{body}</p>
      </div>
    </div>
  );
}
