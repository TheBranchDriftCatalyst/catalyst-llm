import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Coins,
  Gauge,
  Timer,
  Zap,
} from "lucide-react";
import type { Chat } from "../../react/chat/index.js";
import {
  useChatCost,
  formatUsd,
  formatTokens,
  formatMs,
  formatRate,
} from "../../react/useChatCost.js";
import { useModels } from "../../react/hooks.js";
import { cn } from "../shared/utils.js";

export interface CostPinsProps {
  chat: Chat | undefined;
  /** Briefly highlight the cost pin when a new turn lands. Default true. */
  flashOnUpdate?: boolean;
  /** Compact rail variant — no per-pin border, no flashing ring, tighter
   *  padding, smaller font. Designed for the dense ChatStatsRow. */
  compact?: boolean;
  className?: string;
}

interface PinProps {
  icon: React.ElementType;
  label: string;
  value: string;
  flash?: boolean;
  emphasis?: "default" | "primary" | "muted";
  compact?: boolean;
  /** When true and ``compact``, the pin is hidden in narrow containers
   *  (<360px) via a Tailwind v4 @container query. Three priority pins
   *  (calls, cost, ttft) leave this off so they always survive. */
  collapsible?: boolean;
}

function Pin({ icon: Icon, label, value, flash, emphasis = "default", compact, collapsible }: PinProps) {
  if (compact) {
    return (
      <span
        data-testid={`cost-pin-${label}`}
        className={cn(
          "inline-flex items-center gap-1 px-1 shrink-0 min-w-0 transition-colors",
          collapsible && "@max-[360px]:hidden",
          emphasis === "primary"
            ? "text-primary"
            : emphasis === "muted"
              ? "text-muted-foreground"
              : "text-foreground",
        )}
      >
        <Icon className="h-2.5 w-2.5 opacity-70 shrink-0" />
        <span className="text-[8.5px] uppercase tracking-[0.18em] opacity-70 tabular-nums">
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums">{value}</span>
      </span>
    );
  }
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-all duration-200",
        emphasis === "primary"
          ? "border-primary/50 bg-primary/10 text-primary"
          : emphasis === "muted"
            ? "border-border/40 bg-muted/30 text-muted-foreground"
            : "border-border/60 bg-card/40",
        flash && "ring-2 ring-primary/70 ring-offset-1 ring-offset-background",
      )}
    >
      <Icon className="h-3 w-3 opacity-80" />
      <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">
        {label}
      </span>
      <span className="font-mono text-xs font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

/**
 * Live stat pins for a single chat — calls, in/out tokens, total tokens,
 * cumulative USD spend. The cost pin flashes briefly when a new turn arrives,
 * borrowing the pattern from langgraph-dev's CostTicker so the operator
 * notices spend changes in their peripheral vision.
 */
export function CostPins({
  chat,
  flashOnUpdate = true,
  compact = false,
  className,
}: CostPinsProps) {
  const { models } = useModels();
  const stats = useChatCost(chat, models);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!flashOnUpdate || stats.calls === 0) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
    // re-run when calls increment OR last-turn cost changes
  }, [stats.calls, stats.lastTurnCostUsd, flashOnUpdate]);

  return (
    <div
      data-testid="cost-pins"
      className={cn(
        "flex items-center min-w-0",
        compact
          ? "flex-nowrap gap-0 divide-x divide-border/15 overflow-hidden"
          : "flex-wrap gap-1.5",
        className,
      )}
    >
      <Pin
        icon={Activity}
        label="calls"
        value={String(stats.calls)}
        compact={compact}
      />
      <Pin
        icon={ArrowUp}
        label="in"
        value={formatTokens(stats.inputTokens)}
        emphasis="muted"
        compact={compact}
        collapsible
      />
      <Pin
        icon={ArrowDown}
        label="out"
        value={formatTokens(stats.outputTokens)}
        emphasis="muted"
        compact={compact}
        collapsible
      />
      <Pin
        icon={Timer}
        label="ttft"
        value={formatMs(stats.lastTtftMs)}
        emphasis={stats.lastTtftMs === null ? "muted" : "default"}
        compact={compact}
      />
      <Pin
        icon={Zap}
        label="tok/s"
        value={formatRate(stats.lastTokensPerSec)}
        emphasis={stats.lastTokensPerSec === null ? "muted" : "default"}
        compact={compact}
        collapsible
      />
      <Pin
        icon={Gauge}
        label="rt"
        value={formatMs(stats.lastLatencyMs)}
        emphasis="muted"
        compact={compact}
        collapsible
      />
      <Pin
        icon={Coins}
        label="cost"
        value={formatUsd(stats.costUsd)}
        emphasis="primary"
        flash={flash}
        compact={compact}
      />
    </div>
  );
}
