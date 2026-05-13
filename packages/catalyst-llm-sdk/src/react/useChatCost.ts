import { useMemo } from "react";
import type { Chat } from "./chat/index.js";
import type { ModelWithRouting } from "../client/index.js";

export interface ChatCostStats {
  /** Number of assistant turns that have completed (have `meta.usage`). */
  calls: number;
  /** Total prompt tokens billed. */
  inputTokens: number;
  /** Total completion tokens billed. */
  outputTokens: number;
  /** Total tokens (input + output). */
  totalTokens: number;
  /** Total USD cost across all calls in this chat. */
  costUsd: number;
  /** USD spent on the most recent assistant message (used to flash the ticker). */
  lastTurnCostUsd: number;
  /** Time-to-first-token for the most-recent turn, ms. Null if not yet measured. */
  lastTtftMs: number | null;
  /** Output tokens-per-second for the most-recent turn. Null if not measurable. */
  lastTokensPerSec: number | null;
  /** Total round-trip latency for the most-recent turn, ms. */
  lastLatencyMs: number | null;
}

const ZERO: ChatCostStats = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  lastTurnCostUsd: 0,
  lastTtftMs: null,
  lastTokensPerSec: null,
  lastLatencyMs: null,
};

/**
 * Aggregates per-turn token usage from a chat into running cost stats. Pricing
 * comes from each turn's logged model — falls back to the chat's current model
 * if a turn doesn't declare its own. Local models (zero cost-per-token) cleanly
 * contribute zero.
 */
export function useChatCost(
  chat: Chat | undefined,
  models: ModelWithRouting[],
): ChatCostStats {
  const priceByModel = useMemo(() => {
    const map = new Map<string, { input: number; output: number }>();
    for (const m of models) {
      map.set(m.id, {
        input: m.metadata?.input_cost_per_token ?? 0,
        output: m.metadata?.output_cost_per_token ?? 0,
      });
    }
    return map;
  }, [models]);

  return useMemo(() => {
    if (!chat) return ZERO;
    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let lastTurnCostUsd = 0;
    for (const turn of chat.messages) {
      if (turn.role !== "assistant") continue;
      const usage = turn.meta?.usage;
      if (!usage) continue;
      calls += 1;
      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? 0;
      inputTokens += inTok;
      outputTokens += outTok;
      const price = priceByModel.get(turn.meta?.model ?? chat.model);
      const turnCost =
        (price?.input ?? 0) * inTok + (price?.output ?? 0) * outTok;
      costUsd += turnCost;
      lastTurnCostUsd = turnCost;
    }
    // Latency stats for the most-recent turn (only meaningful once it's done
    // streaming — we use streamEndTime to compute output throughput).
    const ttft =
      chat.firstTokenTime && chat.streamStartTime
        ? chat.firstTokenTime - chat.streamStartTime
        : null;
    const lastTurn = [...chat.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.meta?.usage);
    const lastOutputTokens = lastTurn?.meta?.usage?.completion_tokens ?? 0;
    const generationMs =
      chat.firstTokenTime && chat.streamEndTime
        ? chat.streamEndTime - chat.firstTokenTime
        : null;
    const tokensPerSec =
      generationMs && generationMs > 0 && lastOutputTokens > 0
        ? (lastOutputTokens / generationMs) * 1000
        : null;
    const latency =
      chat.streamStartTime && chat.streamEndTime
        ? chat.streamEndTime - chat.streamStartTime
        : null;

    return {
      calls,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
      lastTurnCostUsd,
      lastTtftMs: ttft,
      lastTokensPerSec: tokensPerSec,
      lastLatencyMs: latency,
    };
  }, [chat, priceByModel]);
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatRate(n: number | null): string {
  if (n === null) return "—";
  if (n >= 100) return `${n.toFixed(0)}/s`;
  if (n >= 10) return `${n.toFixed(1)}/s`;
  return `${n.toFixed(2)}/s`;
}

export function formatUsd(n: number, sigDigits = 6): string {
  if (n === 0) return "$0.00";
  const abs = Math.abs(n);
  if (abs >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(sigDigits)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
