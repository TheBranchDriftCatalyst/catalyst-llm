/**
 * Client for the catalyst-langgraph backend.
 *
 * `streamAgent(req, opts)` returns an AsyncIterable<AgentEvent> over
 * the SSE channel exposed at POST /api/chat/stream. Consumers (e.g.
 * the playground's chatStore) iterate to react to tokens, tool calls,
 * iteration markers, and the final message_done event without ever
 * caring that the wire format is SSE.
 *
 * Why we don't use EventSource: it's GET-only and gives no way to
 * carry a JSON body. We do a plain fetch + manual SSE parsing — the
 * code is small and gets us POST + Authorization headers + abort.
 */

import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventType,
  type ChatStreamRequest,
} from "./events.js";

export interface AgentClientConfig {
  /** Base URL of the catalyst-langgraph service (e.g. http://localhost:7078). */
  baseUrl: string;
  /** Optional bearer token if the service is behind auth. */
  apiKey?: string;
  /** fetch override for non-browser runtimes / tests. */
  fetchImpl?: typeof fetch;
}

export interface ListModelsResponse {
  data: Array<{
    id: string;
    underlying_model?: string | null;
    api_base?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
}

export interface ListToolsResponse {
  tools: Array<{
    name: string;
    description: string;
    args_schema?: Record<string, unknown> | null;
  }>;
  tool_host: { reachable: boolean; [key: string]: unknown };
}

export interface StreamOptions {
  /** AbortSignal to cancel the stream from the consumer side. */
  signal?: AbortSignal;
}

const TYPE_SET = new Set<string>(AGENT_EVENT_TYPES);

function isAgentEventType(s: string): s is AgentEventType {
  return TYPE_SET.has(s);
}

export class CatalystAgentClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AgentClientConfig) {
    // Strip trailing slash so paths concat cleanly. baseUrl is the
    // root of the service ("http://localhost:7078"), not an API root.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels(): Promise<ListModelsResponse> {
    const resp = await this.fetchImpl(`${this.baseUrl}/api/models`, {
      headers: this.headers,
    });
    if (!resp.ok) {
      throw new Error(`listModels failed: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as ListModelsResponse;
  }

  async listTools(): Promise<ListToolsResponse> {
    const resp = await this.fetchImpl(`${this.baseUrl}/api/tools`, {
      headers: this.headers,
    });
    if (!resp.ok) {
      throw new Error(`listTools failed: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as ListToolsResponse;
  }

  /**
   * Stream agent events. Returns an AsyncIterable; consumers should
   * `for await (const ev of streamAgent(...))`. The generator always
   * either runs to completion (terminating message_done or error) or
   * exits cleanly on AbortSignal.
   */
  streamAgent(
    req: ChatStreamRequest,
    opts: StreamOptions = {},
  ): AsyncIterable<AgentEvent> {
    const url = `${this.baseUrl}/api/chat/stream`;
    const headers = this.headers;
    const fetchImpl = this.fetchImpl;
    return {
      [Symbol.asyncIterator]: async function* () {
        const resp = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(req),
          signal: opts.signal,
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(
            `streamAgent failed: ${resp.status} ${resp.statusText} ${text}`,
          );
        }
        if (!resp.body) {
          throw new Error("streamAgent: response has no body");
        }
        yield* parseAgentSSE(resp.body);
      },
    };
  }
}

/**
 * Parse a Server-Sent Events stream into AgentEvents.
 *
 * SSE wire format reminder: messages are separated by blank lines.
 * Within a message, lines like `event: foo` and `data: {...}` accumulate.
 * Our backend (sse-starlette) emits one named event per logical message
 * with a single JSON `data` line. We trust the JSON payload's `type`
 * field over the event-name header — the data is the source of truth
 * — but we use the event name as a fast-path filter when present.
 */
export async function* parseAgentSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on the SSE message boundary (\n\n). Anything before the
      // last boundary is a complete message; the tail is partial and
      // stays in the buffer.
      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSSEMessage(raw);
        if (ev) yield ev;
      }
    }
    // Tail after stream close — emit if it's a complete message.
    if (buffer.trim()) {
      const ev = parseSSEMessage(buffer);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEMessage(raw: string): AgentEvent | null {
  let eventName: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue; // comment/empty
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // The spec allows an optional space after the colon; strip exactly one.
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  // Trust payload.type over event name; fall back to event name when absent.
  const obj = json as Record<string, unknown>;
  const t = typeof obj.type === "string" ? obj.type : eventName;
  if (!t || !isAgentEventType(t)) return null;
  return { ...obj, type: t } as AgentEvent;
}
