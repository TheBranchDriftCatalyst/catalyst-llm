import { Cpu } from "lucide-react";
import type { Chat } from "../react/chat/index.js";
import type { ModelWithRouting } from "../client/index.js";
import { effectiveMetadata } from "../client/modelHints.js";
import { formatTokens } from "../react/useChatCost.js";
import { cn } from "./utils.js";

export interface ContextMeterProps {
  chat: Chat | undefined;
  model: ModelWithRouting | undefined;
  className?: string;
  /**
   * "chip" (default) — compact inline gauge with a 24px-wide bar,
   *   meant to sit next to other stats chips.
   * "bar" — full-width thin progress bar with a minimal label,
   *   meant to span the chat window under the stats chip row so
   *   the operator sees fill-level at a glance.
   */
  variant?: "chip" | "bar";
}

/**
 * Live context-window meter for a single chat. Reads `prompt_tokens` off the
 * most recent assistant turn — that's the exact number of tokens the server
 * saw on the last send (system + history + user). The model's
 * `max_input_tokens` provides the denominator. Local models without declared
 * limits render as a flat "tokens used" pill instead of a progress bar.
 */
export function ContextMeter({
  chat,
  model,
  className,
  variant = "chip",
}: ContextMeterProps) {
  const lastAssistant = [...(chat?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.meta?.usage?.prompt_tokens);
  const used = lastAssistant?.meta?.usage?.prompt_tokens ?? 0;
  // effectiveMetadata layers in heuristic context windows for local models
  // (DeepSeek R1: 64k, Llama 3.x: 128k, etc.) so the meter shows a real bar
  // instead of just a chip when LiteLLM has no metadata.
  const eff = effectiveMetadata(model);
  const max = eff.max_input_tokens ?? eff.max_tokens;

  // Estimate when we have prior turns but no usage data (local model paths
  // sometimes drop usage). Rough heuristic: 4 chars ≈ 1 token. Marked
  // explicitly so the UI doesn't overstate certainty.
  const usedIsEstimate = !used && (chat?.messages.length ?? 0) > 0;
  const estimated = usedIsEstimate
    ? Math.round(
        ((chat?.systemPrompt.length ?? 0) +
          (chat?.messages.reduce((acc, m) => acc + m.content.length, 0) ?? 0)) /
          4,
      )
    : 0;
  const display = used || estimated;

  if (!chat) return null;

  if (!max) {
    if (variant === "bar") {
      // No declared max — render a thin "unknown" rail with just the
      // raw token count. Keeps the bar slot occupied so the chat
      // header doesn't jitter when the operator switches models.
      return (
        <div
          className={cn("w-full px-4 py-1.5", className)}
          title="Model didn't declare a context window — showing raw tokens used on the last send."
        >
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Cpu className="h-3 w-3 text-primary opacity-80" />
              context
            </span>
            <span className="font-mono normal-case tracking-normal tabular-nums text-foreground/80">
              {display ? formatTokens(display) : "0"}
              {usedIsEstimate && (
                <span className="ml-1 text-[9px] opacity-60">est</span>
              )}
              <span className="ml-1.5 opacity-50">/ unknown</span>
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted/30" />
        </div>
      );
    }
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1",
          className,
        )}
        title="Model didn't declare a context window — showing raw tokens used on the last send."
      >
        <Cpu className="h-3 w-3 text-primary opacity-80" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          ctx
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums">
          {display ? formatTokens(display) : "0"}
          {usedIsEstimate && (
            <span className="ml-0.5 text-[9px] opacity-60">est</span>
          )}
        </span>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((display / max) * 100));
  const tone =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
        ? "bg-yellow-500"
        : "bg-primary";

  if (variant === "bar") {
    return (
      <div
        className={cn("w-full px-4 py-1.5", className)}
        title={`Last send used ${display.toLocaleString()} / ${max.toLocaleString()} input tokens (${pct}%). Updates after each turn.`}
      >
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-3 w-3 text-primary opacity-80" />
            context
          </span>
          <span className="font-mono normal-case tracking-normal tabular-nums text-foreground/80">
            {formatTokens(display)}
            <span className="opacity-50">/{formatTokens(max)}</span>
            <span className="ml-1.5 opacity-60">{pct}%</span>
            {usedIsEstimate && (
              <span className="ml-1 text-[9px] opacity-60">est</span>
            )}
          </span>
        </div>
        <div
          className="relative h-1 w-full overflow-hidden rounded-full bg-muted/50"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={display}
          aria-label="Context window usage"
        >
          <div
            className={cn("h-full transition-all duration-300", tone)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1",
        className,
      )}
      title={`Last send used ${display.toLocaleString()} / ${max.toLocaleString()} input tokens (${pct}%). Updates after each turn.`}
    >
      <Cpu className="h-3 w-3 text-primary opacity-80 shrink-0" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        ctx
      </span>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted/50">
        <div
          className={cn("h-full transition-all duration-300", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold tabular-nums">
        {formatTokens(display)}
        <span className="opacity-50">/{formatTokens(max)}</span>
        {usedIsEstimate && (
          <span className="ml-0.5 text-[9px] opacity-60">est</span>
        )}
      </span>
    </div>
  );
}
