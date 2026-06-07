/**
 * ChatStatsRow — thin horizontal stat strip for a Chat.
 *
 * Wraps CostPins + a streaming indicator. In dense mode, auto-hides
 * when the chat is empty and not streaming so an unused rail stays
 * clean. Use as a fixed-position footer in dense layouts, or as a
 * header strip in standard layouts.
 */
import type { Chat, ChatTurn } from "../../react/chat/index.js";
import { CostPins } from "../stats/CostPins.js";
import { cn } from "../shared/utils.js";

export interface ChatStatsRowProps {
  chat: Chat;
  /** Tight rail variant. Compacts the cost pins and auto-hides when
   *  the chat has no activity. */
  dense?: boolean;
  /** When dense + empty + not streaming, force showing the strip
   *  anyway. Default false (auto-hide). */
  showWhenEmpty?: boolean;
  className?: string;
}

export function ChatStatsRow({
  chat,
  dense = false,
  showWhenEmpty = false,
  className,
}: ChatStatsRowProps) {
  const isEmpty = chat.messages.length === 0 && !chat.isStreaming;
  if (dense && isEmpty && !showWhenEmpty) return null;

  return (
    <div
      data-testid="chat-stats-row"
      className={cn(
        "shrink-0 bg-background flex items-center gap-2 min-w-0 overflow-hidden",
        // @container query — CostPins reads this to collapse to the
        // three priority pins (calls / cost / ttft) under ~360px.
        dense ? "@container px-2 py-1" : "px-4 py-2",
        className,
      )}
    >
      <CostPins chat={chat} compact={dense} flashOnUpdate={!dense} />
      <LatencyHeatmap chat={chat} />
      {chat.isStreaming && (
        <span
          className={cn(
            "ml-auto shrink-0 uppercase animate-pulse text-primary",
            dense
              ? "text-[9px] tracking-[0.22em]"
              : "text-[10px] tracking-wider",
          )}
        >
          {dense ? "◇ streaming" : "streaming…"}
        </span>
      )}
    </div>
  );
}

// ── PRO10: latency heatmap ───────────────────────────────────────────
//
// A 24-cell wide, 4px-tall svg strip rendered immediately right of the
// CostPins. Each cell encodes the duration of one of the last 24
// assistant turns by (meta.streamEndTime - meta.streamStartTime).
// Color bands: green (<500ms), amber (<2s), red (>=2s). Empty / negative
// durations are dropped silently; if the chat has none, the strip is
// not rendered.
//
// The fields read here are open extensions on `StreamMeta` (the SDK
// doesn't formalize them yet but the operator stream-handler writes
// them per-turn), hence the typed lookup helpers below.

const HEAT_CELLS = 24;
const HEAT_CELL_W = 2;
const HEAT_H = 4;

function turnLatencyMs(turn: ChatTurn): number | null {
  if (turn.role !== "assistant") return null;
  const meta = turn.meta as
    | (typeof turn.meta & {
        streamStartTime?: number;
        streamEndTime?: number;
      })
    | undefined;
  const start = typeof meta?.streamStartTime === "number" ? meta.streamStartTime : null;
  const end = typeof meta?.streamEndTime === "number" ? meta.streamEndTime : null;
  if (start === null || end === null) return null;
  const dur = end - start;
  if (dur <= 0) return null;
  return dur;
}

function latencyBandColor(ms: number): string {
  if (ms < 500) return "#22c55e"; // green-500
  if (ms < 2000) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

function LatencyHeatmap({ chat }: { chat: Chat }) {
  const series: number[] = [];
  for (const turn of chat.messages) {
    const ms = turnLatencyMs(turn);
    if (ms !== null) series.push(ms);
  }
  const samples = series.slice(-HEAT_CELLS);
  if (samples.length === 0) return null;

  const w = HEAT_CELLS * HEAT_CELL_W;
  return (
    <svg
      data-testid="chat-latency-heatmap"
      width={w}
      height={HEAT_H}
      viewBox={`0 0 ${w} ${HEAT_H}`}
      className="shrink-0 opacity-70"
      aria-label={`latency heatmap, last ${samples.length} turns`}
      role="img"
    >
      {samples.map((ms, i) => (
        <rect
          key={i}
          x={i * HEAT_CELL_W}
          y={0}
          width={HEAT_CELL_W}
          height={HEAT_H}
          fill={latencyBandColor(ms)}
        />
      ))}
    </svg>
  );
}
