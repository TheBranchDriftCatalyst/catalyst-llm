import { describe, it, expect } from "vitest";
import {
  CatalystAgentClient,
  parseAgentSSE,
  type AgentEvent,
} from "../src/agent/index.js";

function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe("parseAgentSSE", () => {
  it("decodes a sequence of named events with JSON payloads", async () => {
    const body = sseStream([
      // Each SSE message terminates with a blank line (\n\n).
      'event: run_started\ndata: {"type":"run_started","run_id":"r1","model":"m"}\n\n',
      'event: token\ndata: {"type":"token","content":"hi "}\n\n',
      'event: token\ndata: {"type":"token","content":"there"}\n\n',
      'event: tool_call_start\ndata: {"type":"tool_call_start","id":"t1","name":"web_search","args":{"query":"x"}}\n\n',
      'event: tool_call_end\ndata: {"type":"tool_call_end","id":"t1","result":"ok","duration_ms":42}\n\n',
      'event: message_done\ndata: {"type":"message_done","finish_reason":"stop"}\n\n',
    ]);
    const events = await collect(parseAgentSSE(body));
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "token",
      "token",
      "tool_call_start",
      "tool_call_end",
      "message_done",
    ]);
    const tokens = events.filter((e): e is AgentEvent & { type: "token" } => e.type === "token");
    expect(tokens.map((t) => t.content).join("")).toBe("hi there");
    const start = events.find((e) => e.type === "tool_call_start") as any;
    expect(start.args).toEqual({ query: "x" });
    const end = events.find((e) => e.type === "tool_call_end") as any;
    expect(end.duration_ms).toBe(42);
  });

  it("handles messages split across read boundaries", async () => {
    // Same payload but chopped in awkward places — the parser must
    // buffer until it sees \n\n.
    const body = sseStream([
      'event: token\nda',
      'ta: {"type":"token","conten',
      't":"split"}\n',
      "\n",
      'event: message_done\ndata: {"type":"message_done"}\n\n',
    ]);
    const events = await collect(parseAgentSSE(body));
    expect(events.length).toBe(2);
    expect((events[0] as any).content).toBe("split");
    expect(events[1].type).toBe("message_done");
  });

  it("ignores unknown event types rather than throwing", async () => {
    const body = sseStream([
      'event: token\ndata: {"type":"token","content":"a"}\n\n',
      'event: surprise\ndata: {"type":"surprise","whatever":1}\n\n',
      'event: message_done\ndata: {"type":"message_done"}\n\n',
    ]);
    const events = await collect(parseAgentSSE(body));
    expect(events.map((e) => e.type)).toEqual(["token", "message_done"]);
  });

  it("ignores comments and malformed JSON without aborting the stream", async () => {
    const body = sseStream([
      ": keepalive ping\n\n",
      'event: token\ndata: not-json\n\n',
      'event: token\ndata: {"type":"token","content":"survived"}\n\n',
    ]);
    const events = await collect(parseAgentSSE(body));
    expect(events.length).toBe(1);
    expect((events[0] as any).content).toBe("survived");
  });
});

describe("CatalystAgentClient", () => {
  it("listModels fetches /api/models with the configured base URL", async () => {
    const seen: { url?: string } = {};
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      seen.url = String(input);
      return new Response(
        JSON.stringify({ data: [{ id: "gpt-4o" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const client = new CatalystAgentClient({
      baseUrl: "http://lg:7078/",
      fetchImpl: fakeFetch,
    });
    const out = await client.listModels();
    expect(seen.url).toBe("http://lg:7078/api/models");
    expect(out.data[0].id).toBe("gpt-4o");
  });

  it("streamAgent POSTs the request body and yields parsed events", async () => {
    const seen: { url?: string; body?: string; method?: string } = {};
    const fakeFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.url = String(input);
      seen.method = init?.method;
      seen.body = typeof init?.body === "string" ? init.body : "";
      const body = sseStream([
        'event: run_started\ndata: {"type":"run_started","run_id":"r","model":"m"}\n\n',
        'event: token\ndata: {"type":"token","content":"hi"}\n\n',
        'event: message_done\ndata: {"type":"message_done","finish_reason":"stop"}\n\n',
      ]);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    const client = new CatalystAgentClient({
      baseUrl: "http://lg:7078",
      apiKey: "sk-xxx",
      fetchImpl: fakeFetch,
    });

    const events = await collect(
      client.streamAgent({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("http://lg:7078/api/chat/stream");
    const sent = JSON.parse(seen.body ?? "{}");
    expect(sent.model).toBe("m");
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "token",
      "message_done",
    ]);
  });

  it("streamAgent throws on non-2xx with body text in the message", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response("boom", {
        status: 500,
        statusText: "Internal Server Error",
      })) as typeof fetch;
    const client = new CatalystAgentClient({
      baseUrl: "http://lg:7078",
      fetchImpl: fakeFetch,
    });
    await expect(
      collect(client.streamAgent({ model: "m", messages: [] })),
    ).rejects.toThrow(/500.*boom/);
  });
});
