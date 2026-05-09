/**
 * Metrics dashboard — runs entirely in the browser against a local
 * DuckDB-WASM store. Three panes stacked vertically:
 *
 *   1. Header bar with row count, ephemeral / persistent badge,
 *      Refresh and Export buttons.
 *   2. Per-model summary cards (one per partition) — total runs,
 *      avg tok/s, avg cost, p50/p95 ttft.
 *   3. Free-form SQL pane: a textarea pre-loaded with a useful query,
 *      a Run button, and a results table.
 *
 * All queries are dispatched via `query()` from db.js so the wasm
 * download is shared with whatever recorded the data in the first place.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Download,
  Play,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import {
  exportPartitionedParquet,
  query,
  type MetricsRow,
} from "./db.js";
import { useMetricsStore } from "./store.js";
import { AggregateCharts } from "./AggregateCharts.js";

const DEFAULT_SQL = `-- Average tokens/sec by model, last 7 days
SELECT
  model,
  COUNT(*)                              AS runs,
  AVG(tokens_per_sec)                   AS avg_tok_s,
  AVG(ttft_ms)                          AS avg_ttft_ms,
  SUM(cost_usd)                         AS total_cost_usd,
  MAX(ts)                               AS last_run
FROM metrics
WHERE ts > now() - INTERVAL 7 DAY
GROUP BY model
ORDER BY runs DESC;
`;

interface PerModelSummary {
  model: string;
  runs: number;
  avg_tok_s: number | null;
  avg_ttft_ms: number | null;
  p50_ttft_ms: number | null;
  p95_ttft_ms: number | null;
  total_cost_usd: number | null;
  last_run: Date | null;
}

export function StatsView() {
  const rowCount = useMetricsStore((s) => s.rowCount);
  const lastError = useMetricsStore((s) => s.lastError);

  const [summaries, setSummaries] = useState<PerModelSummary[]>([]);
  const [ephemeral, setEphemeral] = useState<boolean | null>(null);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [sqlRows, setSqlRows] = useState<Record<string, unknown>[] | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Refresh summary cards when new rows arrive (rowCount bumps from
  // the recorder). Initial load also runs through this effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ephRows = await query<{ value: string }>(
          "SELECT value FROM sink_meta WHERE key = 'ephemeral'",
        ).catch(() => [] as { value: string }[]);
        if (!cancelled) setEphemeral(ephRows[0]?.value === "true");

        // Quantile aggregation in DuckDB uses approx_quantile for speed.
        const rows = await query<PerModelSummary>(`
          SELECT
            model,
            COUNT(*)::INTEGER                   AS runs,
            AVG(tokens_per_sec)                 AS avg_tok_s,
            AVG(ttft_ms)                        AS avg_ttft_ms,
            approx_quantile(ttft_ms, 0.50)      AS p50_ttft_ms,
            approx_quantile(ttft_ms, 0.95)      AS p95_ttft_ms,
            SUM(cost_usd)                       AS total_cost_usd,
            MAX(ts)                             AS last_run
          FROM metrics
          GROUP BY model
          ORDER BY runs DESC, model
        `);
        if (!cancelled) setSummaries(rows);
      } catch (err) {
        if (!cancelled) {
          console.warn("[StatsView] summary refresh failed:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rowCount]);

  async function runSql() {
    setRunning(true);
    setSqlError(null);
    try {
      const rows = await query(sql);
      setSqlRows(rows as Record<string, unknown>[]);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : String(err));
      setSqlRows(null);
    } finally {
      setRunning(false);
    }
  }

  async function exportParquet() {
    try {
      const paths = await exportPartitionedParquet();
      window.alert(
        `Exported ${paths.length} per-model Parquet file(s) to OPFS:\n\n` +
          paths.join("\n") +
          `\n\nOpen them with: duckdb -c "SELECT * FROM read_parquet('<path>')"`,
      );
    } catch (err) {
      window.alert(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const totalRuns = useMemo(
    () => summaries.reduce((acc, s) => acc + (s.runs ?? 0), 0),
    [summaries],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-border bg-muted/10 px-4 py-2">
        <Database className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          metrics
        </span>
        <span className="text-[10px] text-muted-foreground/70">
          duckdb-wasm · {totalRuns.toLocaleString()} runs across{" "}
          {summaries.length} model(s) · {rowCount.toLocaleString()} this session
        </span>
        {ephemeral === true && (
          <span
            className="ml-1 inline-flex items-center gap-1 rounded-sm border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-yellow-600 dark:text-yellow-300"
            title="OPFS unavailable — data is session-local. Export Parquet to keep it."
          >
            <AlertTriangle className="h-3 w-3" />
            ephemeral
          </span>
        )}
        {lastError && (
          <span
            className="rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive"
            title={lastError}
          >
            write error
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => useMetricsStore.setState((s) => ({ rowCount: s.rowCount + 0.0 }))}
            title="Refresh summaries"
            className="text-[10px]"
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={exportParquet}
            disabled={summaries.length === 0}
            title="Write one Parquet file per model into OPFS"
            className="text-[10px]"
          >
            <Download className="mr-1 h-3 w-3" />
            export
          </Button>
        </div>
      </header>

      {/* ─── Aggregate visualizations (radar + stacked rank) ─────── */}
      {summaries.length > 0 && (
        <div className="border-b border-border/60 bg-card/10 p-3">
          <AggregateCharts summaries={summaries} />
        </div>
      )}

      {/* ─── Per-model summary cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 overflow-x-auto border-b border-border/60 bg-card/20 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {summaries.length === 0 && !loading && (
          <EmptyState />
        )}
        {summaries.map((s) => (
          <SummaryCard key={s.model} summary={s} />
        ))}
      </div>

      {/* ─── Free-form SQL pane ──────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/10 px-3 py-1.5">
          <TrendingUp className="h-3 w-3 text-primary" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            sql · runs against the in-browser DuckDB
          </span>
          <Button
            type="button"
            size="sm"
            onClick={runSql}
            disabled={running}
            className="ml-auto"
            title="Run query (⌘↵)"
          >
            <Play className="mr-1 h-3 w-3" />
            {running ? "running…" : "run"}
          </Button>
        </div>
        <Textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void runSql();
            }
          }}
          className="min-h-[120px] resize-none rounded-none border-0 border-b border-border/40 font-mono text-xs leading-relaxed focus-visible:ring-0"
        />
        <div className="flex-1 overflow-auto p-3">
          {sqlError && (
            <pre
              role="alert"
              className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {sqlError}
            </pre>
          )}
          {!sqlError && sqlRows && <ResultsTable rows={sqlRows} />}
          {!sqlError && !sqlRows && (
            <p className="text-xs text-muted-foreground">
              Press <kbd className="rounded bg-muted px-1">⌘↵</kbd> or click{" "}
              <kbd className="rounded bg-muted px-1">run</kbd> to execute. Tables: <code>metrics</code>,{" "}
              <code>sink_meta</code>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ summary }: { summary: PerModelSummary }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="truncate font-mono text-xs font-bold text-primary">
          {summary.model}
        </span>
        <span className="ml-2 shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
          {summary.runs.toLocaleString()}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <Stat label="tok/s" value={fmtNum(summary.avg_tok_s, 1)} />
        <Stat label="ttft p50" value={fmtMs(summary.p50_ttft_ms)} />
        <Stat label="cost"   value={fmtUsd(summary.total_cost_usd)} />
        <Stat label="ttft p95" value={fmtMs(summary.p95_ttft_ms)} />
      </dl>
      {summary.last_run && (
        <p className="mt-1 truncate text-[9px] text-muted-foreground/70">
          last: {fmtTime(summary.last_run)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1.5">
      <dt className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function ResultsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No rows.</p>;
  }
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-auto rounded-md border border-border/60">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/40 text-left font-semibold">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b border-border px-2 py-1 font-mono">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-card/30">
              {cols.map((c) => (
                <td
                  key={c}
                  className="border-b border-border/30 px-2 py-1 font-mono tabular-nums"
                >
                  {fmtCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[9px] text-muted-foreground/70">
        {rows.length.toLocaleString()} rows
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="col-span-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="max-w-md space-y-2">
        <Database className="mx-auto h-8 w-8 opacity-40" />
        <p className="font-medium text-foreground">No metrics yet.</p>
        <p className="text-xs">
          Send a chat or run a Compare and the row will land here. Each
          turn writes one row partitioned by model. Data persists in OPFS
          across reloads (when available); export Parquet for archival.
        </p>
      </div>
    </div>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}
function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function fmtTime(t: Date | string | number): string {
  const d = t instanceof Date ? t : new Date(t);
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString();
}
function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(3);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Re-export the row type so the playground recorder can type the
// fields it sends in.
export type { MetricsRow };
