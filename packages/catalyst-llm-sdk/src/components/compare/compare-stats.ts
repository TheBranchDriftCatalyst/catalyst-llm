/**
 * Pure compare-mode stats helpers — JSON-validity check + per-run
 * cost/throughput maths. No React, no JSX.
 */
import type { ModelWithRouting } from "../../client/index.js";
import type { CompareRun } from "../../react/useCompare.js";

export interface PerRunStats {
  cost: number;
  ttftMs: number | null;
  tokensPerSec: number | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface JsonCheck {
  /** `null` when the text is empty or still streaming. */
  ok: boolean | null;
  /** Whether the JSON came from raw text or stripped fences. */
  source?: "raw" | "fenced";
  /** Parse error message if not ok. */
  error?: string;
}

/**
 * Attempt to parse the response text as JSON. Tries raw first; on failure,
 * looks for the first ```json … ``` (or unlabeled) fenced block and tries
 * that. Done for parity with how models commonly wrap structured output
 * even when asked not to — the badge then honestly reports whether the
 * model held the format contract (raw) vs. cheated with fences.
 */
export function checkJson(text: string, isStreaming: boolean): JsonCheck {
  const trimmed = text.trim();
  if (!trimmed || isStreaming) return { ok: null };
  try {
    JSON.parse(trimmed);
    return { ok: true, source: "raw" };
  } catch (rawErr) {
    // Look for fenced block: ```json\n...\n``` or ```\n...\n```
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
    if (fenceMatch) {
      try {
        JSON.parse(fenceMatch[1].trim());
        return { ok: true, source: "fenced" };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: (rawErr as Error).message };
  }
}

export function statsForRun(
  run: CompareRun,
  model: ModelWithRouting | undefined,
): PerRunStats {
  const inTok = run.meta?.usage?.prompt_tokens ?? 0;
  const outTok = run.meta?.usage?.completion_tokens ?? 0;
  const inCost = model?.metadata?.input_cost_per_token ?? 0;
  const outCost = model?.metadata?.output_cost_per_token ?? 0;
  const ttftMs =
    run.firstTokenTime && run.streamStartTime
      ? run.firstTokenTime - run.streamStartTime
      : null;
  const genMs =
    run.firstTokenTime && run.streamEndTime
      ? run.streamEndTime - run.firstTokenTime
      : null;
  const tokensPerSec =
    genMs && genMs > 0 && outTok > 0 ? (outTok / genMs) * 1000 : null;
  const latencyMs =
    run.streamStartTime && run.streamEndTime
      ? run.streamEndTime - run.streamStartTime
      : null;
  return {
    cost: inCost * inTok + outCost * outTok,
    ttftMs,
    tokensPerSec,
    latencyMs,
    inputTokens: inTok,
    outputTokens: outTok,
  };
}
