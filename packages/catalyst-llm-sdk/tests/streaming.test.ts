import { describe, it, expect } from "vitest";
import { parseSSEChunks } from "../src/client/streaming.js";

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body);
}

describe("parseSSEChunks", () => {
  it("parses delta tokens and reaches done", async () => {
    const resp = sseResponse([
      'data: {"id":"1","model":"m","choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"id":"1","model":"m","choices":[{"delta":{"content":"lo"}}]}\n',
      'data: {"id":"1","model":"m","choices":[{"finish_reason":"stop","delta":{}}]}\n',
      "data: [DONE]\n",
    ]);
    const tokens: string[] = [];
    let saw_done = false;
    let final_meta: Record<string, unknown> = {};
    for await (const chunk of parseSSEChunks(resp)) {
      if (chunk.done) {
        saw_done = true;
        final_meta = chunk.meta as Record<string, unknown>;
        break;
      }
      tokens.push(chunk.delta);
    }
    expect(tokens.join("")).toBe("Hello");
    expect(saw_done).toBe(true);
    expect(final_meta.finish_reason).toBe("stop");
    expect(final_meta.id).toBe("1");
    expect(final_meta.model).toBe("m");
  });

  it("captures usage when present", async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n',
      "data: [DONE]\n",
    ]);
    let usage: any;
    for await (const chunk of parseSSEChunks(resp)) {
      if (chunk.done) {
        usage = chunk.meta.usage;
        break;
      }
    }
    expect(usage).toEqual({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
  });

  it("ignores malformed JSON lines", async () => {
    const resp = sseResponse([
      "data: not-json\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
      "data: [DONE]\n",
    ]);
    const tokens: string[] = [];
    for await (const chunk of parseSSEChunks(resp)) {
      if (chunk.done) break;
      tokens.push(chunk.delta);
    }
    expect(tokens.join("")).toBe("ok");
  });
});
