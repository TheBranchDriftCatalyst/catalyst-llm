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
import type { Chat } from "../react/chatStore.js";
import {
  useChatCost,
  formatUsd,
  formatTokens,
  formatMs,
  formatRate,
} from "../react/useChatCost.js";
import { useModels } from "../react/hooks.js";
import { cn } from "./utils.js";

export interface CostPinsProps {
  chat: Chat | undefined;
  /** Briefly highlight the cost pin when a new turn lands. Default true. */
  flashOnUpdate?: boolean;
  className?: string;
}

interface PinProps {
  icon: React.ElementType;
  label: string;
  value: string;
  flash?: boolean;
  emphasis?: "default" | "primary" | "muted";
}

function Pin({ icon: Icon, label, value, flash, emphasis = "default" }: PinProps) {
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
export function CostPins({ chat, flashOnUpdate = true, className }: CostPinsProps) {
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
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Pin icon={Activity} label="calls" value={String(stats.calls)} />
      <Pin
        icon={ArrowUp}
        label="in"
        value={formatTokens(stats.inputTokens)}
        emphasis="muted"
      />
      <Pin
        icon={ArrowDown}
        label="out"
        value={formatTokens(stats.outputTokens)}
        emphasis="muted"
      />
      <Pin
        icon={Timer}
        label="ttft"
        value={formatMs(stats.lastTtftMs)}
        emphasis={stats.lastTtftMs === null ? "muted" : "default"}
      />
      <Pin
        icon={Zap}
        label="tok/s"
        value={formatRate(stats.lastTokensPerSec)}
        emphasis={stats.lastTokensPerSec === null ? "muted" : "default"}
      />
      <Pin
        icon={Gauge}
        label="rt"
        value={formatMs(stats.lastLatencyMs)}
        emphasis="muted"
      />
      <Pin
        icon={Coins}
        label="cost"
        value={formatUsd(stats.costUsd)}
        emphasis="primary"
        flash={flash}
      />
    </div>
  );
}
