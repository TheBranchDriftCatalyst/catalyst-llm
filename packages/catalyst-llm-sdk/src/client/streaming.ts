import type { AssistantToolCall, ChatChunk, StreamMeta } from "./types.js";

/**
 * Stream parser for OpenAI-format chat-completion SSE streams.
 *
 * Yields one ChatChunk per non-empty content delta. The final chunk
 * (done: true) carries the merged StreamMeta plus, when the model
 * decided to invoke tools, an accumulated `tool_calls` array assembled
 * from the per-chunk deltas the OpenAI wire format ships incrementally.
 *
 * Tool-call accumulation: OpenAI streams tool calls as a sparse delta
 * per chunk — `delta.tool_calls[i]` carries an `index`, an optional
 * `id`/`function.name` (typically only on the first delta for that
 * index), and a chunk of `function.arguments` (a JSON string that's
 * built up across many deltas). We accumulate by index and merge.
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
  // Indexed accumulator for tool calls — OpenAI streams them as a
  // sparse delta. We merge by index and emit the consolidated array
  // on the final chunk.
  const pendingTools = new Map<number, AssistantToolCall>();

  const finalize = (): AssistantToolCall[] | undefined => {
    if (pendingTools.size === 0) return undefined;
    return Array.from(pendingTools.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => tc);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { delta: "", meta, done: true, tool_calls: finalize() };
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
          yield { delta: "", meta, done: true, tool_calls: finalize() };
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

        // Content delta — emit verbatim so consumers can stream-paint.
        const content: string = choice.delta?.content ?? "";
        if (content) {
          yield { delta: content, meta, done: false };
        }

        // Tool-call delta — merge by index; never yield mid-flight
        // (the loop in client.streamChat needs the *complete* call
        // before it can dispatch).
        const toolDeltas: any[] | undefined = choice.delta?.tool_calls;
        if (Array.isArray(toolDeltas)) {
          for (const td of toolDeltas) {
            const idx: number = typeof td.index === "number" ? td.index : 0;
            const existing =
              pendingTools.get(idx) ??
              ({
                id: "",
                type: "function",
                function: { name: "", arguments: "" },
              } as AssistantToolCall);
            if (td.id) existing.id = td.id;
            if (td.type) existing.type = td.type;
            if (td.function?.name) existing.function.name = td.function.name;
            if (td.function?.arguments)
              existing.function.arguments += td.function.arguments;
            pendingTools.set(idx, existing);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
