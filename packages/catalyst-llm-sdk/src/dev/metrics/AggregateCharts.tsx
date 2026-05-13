/**
 * Aggregate visualizations for the Stats view.
 *
 * Two complementary lenses on the same DuckDB-derived per-model
 * summaries that the cards already show:
 *
 *   1. RadarChart — every model rendered as a polygon over a shared
 *      polar grid of normalized metrics. Reads as a "fingerprint"
 *      per model — quick visual answer to "which one wins on what".
 *
 *   2. StackedRank — one horizontal bar chart per metric, with EVERY
 *      model in the row sorted best -> worst. Same idea as the
 *      Compare page's Graphs sub-tab, but pulling aggregate data
 *      from the metrics table instead of a single live run.
 *
 * Both are hand-rolled SVG so the Stats view stays bundle-lean (we
 * already paid for DuckDB-WASM; we'd rather not pile on a chart lib
 * on top of that).
 */
import { useMemo, useState } from "react";
import { Radar, BarChart3 } from "lucide-react";
import { cn } from "../../components/shared/utils.js";

export interface PerModelSummary {
  model: string;
  runs: number;
  avg_tok_s: number | null;
  avg_ttft_ms: number | null;
  p50_ttft_ms?: number | null;
  p95_ttft_ms: number | null;
  total_cost_usd: number | null;
  last_run?: Date | null;
}

interface MetricAxis {
  key: keyof PerModelSummary;
  label: string;
  /** When true, the axis is treated as "lower is better" — radar
   * inverts before normalizing, stacked-rank sorts ascending. */
  invert?: boolean;
  /** Pretty-print a value for the bar-row trailing label. */
  format: (n: number) => string;
}

const AXES: MetricAxis[] = [
  {
    key: "avg_tok_s",
    label: "tok/s",
    format: (n) => `${n.toFixed(1)} tok/s`,
  },
  {
    key: "p95_ttft_ms",
    label: "ttft p95",
    invert: true,
    format: (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`),
  },
  {
    key: "avg_ttft_ms",
    label: "ttft avg",
    invert: true,
    format: (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`),
  },
  {
    key: "runs",
    label: "runs",
    format: (n) => n.toLocaleString(),
  },
  {
    key: "total_cost_usd",
    label: "cost",
    invert: true,
    format: (n) =>
      n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`,
  },
];

// Synthwave-ish palette — cycles through up to 12 models. Beyond
// that, models reuse colors but the legend keeps them distinguishable.
const PALETTE = [
  "#ff79c6", // hot pink
  "#bd93f9", // purple
  "#00fcd6", // cyan
  "#50fa7b", // green
  "#f1fa8c", // yellow
  "#ffb86c", // orange
  "#ff5555", // red
  "#8be9fd", // cyan-2
  "#ff6e6e", // coral
  "#9580ff", // violet
  "#80ffea", // teal
  "#ffca80", // peach
];

export function AggregateCharts({
  summaries,
  className,
}: {
  summaries: PerModelSummary[];
  className?: string;
}) {
  const [tab, setTab] = useState<"radar" | "rank">("radar");
  if (summaries.length === 0) {
    return (
      <div className={cn("rounded-md border border-border/40 bg-card/30 p-6", className)}>
        <p className="text-center text-xs text-muted-foreground">
          Run some chats — aggregate visualizations populate from the metrics table.
        </p>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border/60 bg-card/30 p-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          aggregate · all {summaries.length} model{summaries.length === 1 ? "" : "s"} in one
        </span>
        <div
          role="group"
          aria-label="Aggregate view"
          className="ml-auto inline-flex overflow-hidden rounded-md border border-border"
        >
          <button
            type="button"
            aria-pressed={tab === "radar"}
            onClick={() => setTab("radar")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === "radar"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <Radar className="h-3 w-3" aria-hidden="true" />
            radar
          </button>
          <button
            type="button"
            aria-pressed={tab === "rank"}
            onClick={() => setTab("rank")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === "rank"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            <BarChart3 className="h-3 w-3" aria-hidden="true" />
            stacked rank
          </button>
        </div>
      </div>
      {tab === "radar" ? (
        <RadarPanel summaries={summaries} />
      ) : (
        <StackedRankPanel summaries={summaries} />
      )}
    </div>
  );
}

// ─── Radar ────────────────────────────────────────────────────────────

function RadarPanel({ summaries }: { summaries: PerModelSummary[] }) {
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const colorFor = (i: number) => PALETTE[i % PALETTE.length];

  // Pre-normalize: per-axis, find the best/worst across visible models
  // so we can map every value into [0, 1] where 1 is the model's best
  // showing on that axis. Inverted axes (lower-is-better) get flipped
  // so the polygon reads "bigger is better" everywhere.
  const norm = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const ax of AXES) {
      const vals = summaries
        .map((s) => s[ax.key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (vals.length === 0) continue;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      for (const s of summaries) {
        const v = s[ax.key];
        const arr = (out[s.model] ??= []);
        if (typeof v !== "number" || !Number.isFinite(v)) {
          arr.push(0);
          continue;
        }
        const n = (v - min) / range;
        arr.push(ax.invert ? 1 - n : n);
      }
    }
    return out;
  }, [summaries]);

  // SVG geometry
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const N = AXES.length;
  const angleFor = (i: number) => (i / N) * 2 * Math.PI - Math.PI / 2;
  const ringSteps = [0.25, 0.5, 0.75, 1];

  return (
    <div className="grid gap-3 md:grid-cols-[auto_1fr]">
      <svg
        viewBox={`0 0 ${size} ${size + 20}`}
        className="mx-auto w-full max-w-[420px]"
        role="img"
        aria-label="Radar chart of model metrics"
      >
        {/* Concentric grid rings — quietly muted so polygons read first */}
        {ringSteps.map((step) => {
          const pts = AXES.map((_, i) => {
            const a = angleFor(i);
            return `${cx + Math.cos(a) * r * step},${cy + Math.sin(a) * r * step}`;
          }).join(" ");
          return (
            <polygon
              key={step}
              points={pts}
              fill="none"
              stroke="currentColor"
              strokeOpacity={step === 1 ? 0.35 : 0.12}
              strokeDasharray={step === 1 ? undefined : "2 3"}
              className="text-muted-foreground"
            />
          );
        })}
        {/* Axis spokes + labels */}
        {AXES.map((ax, i) => {
          const a = angleFor(i);
          const x2 = cx + Math.cos(a) * r;
          const y2 = cy + Math.sin(a) * r;
          const labelX = cx + Math.cos(a) * (r + 18);
          const labelY = cy + Math.sin(a) * (r + 18);
          // Inset textAnchor based on quadrant for nicer label placement.
          const ta =
            Math.cos(a) > 0.3 ? "start" : Math.cos(a) < -0.3 ? "end" : "middle";
          return (
            <g key={ax.label}>
              <line
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="currentColor"
                strokeOpacity={0.15}
                className="text-muted-foreground"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={ta}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px] font-mono uppercase tracking-wider"
              >
                {ax.label}
                {ax.invert ? " ↓" : ""}
              </text>
            </g>
          );
        })}
        {/* Model polygons — drawn faint when hovered=other for emphasis. */}
        {summaries.map((s, idx) => {
          const vals = norm[s.model] ?? [];
          if (vals.length === 0) return null;
          const pts = vals
            .map((v, i) => {
              const a = angleFor(i);
              const radius = r * Math.max(v, 0.02);
              return `${cx + Math.cos(a) * radius},${cy + Math.sin(a) * radius}`;
            })
            .join(" ");
          const isHovered = hoveredModel === s.model;
          const isDimmed = hoveredModel !== null && !isHovered;
          const color = colorFor(idx);
          return (
            <polygon
              key={s.model}
              points={pts}
              fill={color}
              fillOpacity={isDimmed ? 0.04 : isHovered ? 0.32 : 0.16}
              stroke={color}
              strokeWidth={isHovered ? 2 : 1.25}
              strokeOpacity={isDimmed ? 0.25 : 1}
              className="transition-opacity duration-150"
            />
          );
        })}
      </svg>

      {/* Legend — clicking pins hover; hovering highlights polygon. */}
      <ul className="space-y-1 self-start text-[11px]">
        {summaries.map((s, idx) => {
          const isHovered = hoveredModel === s.model;
          return (
            <li key={s.model}>
              <button
                type="button"
                onMouseEnter={() => setHoveredModel(s.model)}
                onMouseLeave={() =>
                  setHoveredModel((cur) => (cur === s.model ? null : cur))
                }
                onClick={() =>
                  setHoveredModel((cur) => (cur === s.model ? null : s.model))
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left",
                  "hover:bg-accent/30 transition-colors",
                  isHovered && "bg-accent/40",
                )}
                aria-pressed={isHovered}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorFor(idx) }}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "truncate font-mono",
                    isHovered ? "text-foreground" : "text-muted-foreground",
                  )}
                  title={s.model}
                >
                  {s.model}
                </span>
                <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/70">
                  {s.runs.toLocaleString()} run{s.runs === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Stacked-rank bar charts ──────────────────────────────────────────

function StackedRankPanel({ summaries }: { summaries: PerModelSummary[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {AXES.map((ax) => (
        <RankChart key={ax.key as string} axis={ax} summaries={summaries} />
      ))}
    </div>
  );
}

function RankChart({
  axis,
  summaries,
}: {
  axis: MetricAxis;
  summaries: PerModelSummary[];
}) {
  const rows = useMemo(() => {
    const data = summaries.map((s, idx) => ({
      model: s.model,
      value: typeof s[axis.key] === "number" ? (s[axis.key] as number) : null,
      paletteIdx: idx,
    }));
    return data.sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return axis.invert ? a.value - b.value : b.value - a.value;
    });
  }, [axis, summaries]);
  const max = rows.reduce((m, r) => (r.value !== null && r.value > m ? r.value : m), 1);
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold text-primary">{axis.label}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          {axis.invert ? "lower is better" : "higher is better"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const pct = r.value !== null ? Math.max(2, (r.value / max) * 100) : 2;
          const isWinner = i === 0 && r.value !== null;
          return (
            <li
              key={r.model}
              className="flex items-center gap-2 text-[11px]"
            >
              <span
                className={cn(
                  "w-32 shrink-0 truncate font-mono",
                  isWinner ? "text-primary" : "text-muted-foreground",
                )}
                title={r.model}
              >
                {r.model}
              </span>
              <div className="relative flex-1">
                <div
                  className="h-3 rounded-sm transition-[width] duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor:
                      r.value === null
                        ? "var(--muted)"
                        : PALETTE[r.paletteIdx % PALETTE.length],
                    opacity: isWinner ? 1 : 0.7,
                  }}
                />
              </div>
              <span
                className={cn(
                  "w-20 shrink-0 text-right font-mono tabular-nums",
                  isWinner ? "text-primary" : "text-muted-foreground",
                )}
              >
                {r.value === null ? "—" : axis.format(r.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
