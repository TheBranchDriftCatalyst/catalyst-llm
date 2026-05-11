import { sseMessages } from "../sse.js";

import type { ChatChunk, StreamMeta } from "./types.js";

/**
 * Stream parser for OpenAI-format chat-completion SSE streams.
 *
 * Yields one ChatChunk per non-empty content delta. The final chunk
 * (done: true) carries the merged StreamMeta — id / model / created /
 * usage / finish_reason. Tool-call accumulation lived here once but
 * moved to catalyst-langgraph (server-side agent loop) when we
 * stopped running the tool loop in the browser; this parser is now
 * single-purpose: stream tokens to UI consumers (compare view, smoke
 * scripts) that don't need agent semantics.
 *
 * Wire-format parsing lives in ../sse.ts (shared with the agent
 * stream parser). This module owns OpenAI-specific decoding only:
 * the `data: [DONE]` sentinel and merging meta across delta events.
 */
export async function* parseSSEChunks(
  response: Response,
): AsyncGenerator<ChatChunk, void, unknown> {
  if (!response.body) {
    throw new Error("Response has no body to stream");
  }

  const meta: StreamMeta = {};

  for await (const msg of sseMessages(response.body)) {
    if (msg.data === "[DONE]") {
      yield { delta: "", meta, done: true };
      return;
    }
    let json: any;
    try {
      json = JSON.parse(msg.data);
    } catch {
      // OpenAI/LiteLLM occasionally emit pings or comments without
      // valid JSON; skipping is safer than aborting.
      continue;
    }

    if (json.id) meta.id = json.id;
    if (json.model) meta.model = json.model;
    if (json.created) meta.created = json.created;
    if (json.usage) meta.usage = json.usage;

    const choice = json.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) meta.finish_reason = choice.finish_reason;

    const content: string = choice.delta?.content ?? "";
    if (content) {
      yield { delta: content, meta, done: false };
    }
  }

  // Stream ended without a [DONE] sentinel — still emit a terminal
  // chunk so consumers can finalise UI state on the same code path.
  yield { delta: "", meta, done: true };
}
