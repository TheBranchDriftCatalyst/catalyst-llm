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
 */
export async function* parseSSEChunks(
  response: Response,
): AsyncGenerator<ChatChunk, void, unknown> {
  if (!response.body) {
    throw new Error("Response has no body to stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const meta: StreamMeta = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { delta: "", meta, done: true };
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield { delta: "", meta, done: true };
          return;
        }

        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
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
    }
  } finally {
    reader.releaseLock();
  }
}
