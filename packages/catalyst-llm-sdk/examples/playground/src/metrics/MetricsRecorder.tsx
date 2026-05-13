/**
 * Dev-only background subscriber. Watches chat + compare stores and
 * writes one DuckDB-WASM row per completed turn so the /stats tab
 * can chart throughput + cost over a session.
 *
 * Lives at the App root so a single subscription covers both
 * surfaces; render-free, returns null. Module-scoped `_recordedTurns`
 * Set survives StrictMode double-mount + cross-render dedup.
 */
import { useEffect } from "react";
import { useChatStore, useCompareStore } from "@catalyst/llm-sdk";
import { recordMetric, shortHash } from "@catalyst/llm-sdk/dev";

const _recordedTurns = new Set<string>();

export function MetricsRecorder() {
  const chats = useChatStore((s) => s.chats);
  const compareRuns = useCompareStore((s) => s.runs);

  useEffect(() => {
    for (const c of chats) {
      // We key on streamEndTime so a chat re-streamed after `Clear`
      // produces a fresh row even though chat_id and message count
      // are the same.
      if (c.isStreaming || !c.streamEndTime) continue;
      const turnId = `${c.id}:${c.streamEndTime}`;
      if (_recordedTurns.has(turnId)) continue;
      _recordedTurns.add(turnId);
      // Per-message meta is attached to the assistant turn that just
      // finished — fish it off the last message rather than from the
      // chat root (where there is no aggregate field).
      const lastMsg = c.messages[c.messages.length - 1];
      const lastMeta = lastMsg?.role === "assistant" ? lastMsg.meta : undefined;
      const usage = lastMeta?.usage ?? {};
      const ttft = c.firstTokenTime && c.streamStartTime
        ? c.firstTokenTime - c.streamStartTime
        : undefined;
      const duration = c.streamEndTime && c.streamStartTime
        ? c.streamEndTime - c.streamStartTime
        : undefined;
      const completion = usage.completion_tokens;
      const tokSec =
        completion && c.firstTokenTime && c.streamEndTime
          ? completion / ((c.streamEndTime - c.firstTokenTime) / 1000)
          : undefined;
      const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
      void recordMetric({
        ts: new Date(c.streamEndTime),
        chat_id: c.id,
        turn_id: turnId,
        source: "chat",
        model: c.model,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: completion,
        total_tokens: usage.total_tokens,
        ttft_ms: ttft,
        duration_ms: duration,
        tokens_per_sec: tokSec,
        finish_reason: lastMeta?.finish_reason ?? undefined,
        n_messages: c.messages.length,
        ctx_used: usage.prompt_tokens,
        system_prompt_hash: shortHash(c.systemPrompt),
        user_prompt_hash: shortHash(lastUser?.content),
      });
    }
  }, [chats]);

  useEffect(() => {
    for (const [modelId, run] of Object.entries(compareRuns)) {
      if (run.isStreaming || !run.streamEndTime) continue;
      const turnId = `compare:${modelId}:${run.streamEndTime}`;
      if (_recordedTurns.has(turnId)) continue;
      _recordedTurns.add(turnId);
      const usage = run.meta?.usage ?? {};
      const ttft = run.firstTokenTime && run.streamStartTime
        ? run.firstTokenTime - run.streamStartTime
        : undefined;
      const duration = run.streamEndTime && run.streamStartTime
        ? run.streamEndTime - run.streamStartTime
        : undefined;
      const completion = usage.completion_tokens;
      const tokSec =
        completion && run.firstTokenTime && run.streamEndTime
          ? completion / ((run.streamEndTime - run.firstTokenTime) / 1000)
          : undefined;
      void recordMetric({
        ts: new Date(run.streamEndTime),
        turn_id: turnId,
        source: "compare",
        model: modelId,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: completion,
        total_tokens: usage.total_tokens,
        ttft_ms: ttft,
        duration_ms: duration,
        tokens_per_sec: tokSec,
        finish_reason: run.error ? "error" : run.meta?.finish_reason ?? "stop",
        error: run.error,
      });
    }
  }, [compareRuns]);

  return null;
}
