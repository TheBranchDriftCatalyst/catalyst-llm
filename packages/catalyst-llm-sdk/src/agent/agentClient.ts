/**
 * Client for the catalyst-langgraph backend.
 *
 * `streamAgent(req, opts)` returns an AsyncIterable<AgentEvent> over
 * the SSE channel exposed at POST /api/chat/stream. Consumers (e.g.
 * the playground's chatStore) iterate to react to tokens, tool calls,
 * iteration markers, and the final message_done event without ever
 * caring that the wire format is SSE.
 *
 * Wire-format parsing lives in `../sse.ts` (shared with the OpenAI
 * chat-completion stream parser). This module only owns the typed
 * decoding step: JSON.parse the `data` payload, validate the `type`
 * discriminator, log + skip anything unrecognised.
 *
 * Why we don't use the built-in EventSource: it's GET-only and gives
 * no way to carry a JSON body. fetch() + the parser library lets us
 * POST + send Authorization headers + abort, which EventSource can't.
 */

import { sseMessages, type EventSourceMessage } from "../sse.js";

import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventType,
  type ChatStreamRequest,
  type ListAgentsResponse,
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

const AGENT_EVENT_TYPE_SET = new Set<string>(AGENT_EVENT_TYPES);

function isAgentEventType(s: string): s is AgentEventType {
  return AGENT_EVENT_TYPE_SET.has(s);
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
   * List the Agents (compiled LangGraph state machines with their own
   * LLM + loop) registered with catalyst-langgraph. Each entry carries
   * its topology snapshot and the schema of tunables the Engine tab
   * renders as a form. Per-request overrides flow back via the
   * `agent_config` field on `streamAgent`.
   */
  async listAgents(): Promise<ListAgentsResponse> {
    const resp = await this.fetchImpl(`${this.baseUrl}/api/agents`, {
      headers: this.headers,
    });
    if (!resp.ok) {
      throw new Error(`listAgents failed: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as ListAgentsResponse;
  }

  /**
   * Stream agent events. Returns an AsyncIterable; consumers should
   * `for await (const ev of streamAgent(...))`. The generator either
   * runs to completion (terminating message_done or error event) or
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
 * Decode an SSE response body into typed AgentEvents.
 *
 * The wire-format reader lives in ../sse.ts; this generator just
 * walks its output and validates each message against the AgentEvent
 * union. Unknown / malformed frames are logged and skipped so a
 * single bad event can't kill the stream.
 */
export async function* parseAgentSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentEvent, void, unknown> {
  for await (const msg of sseMessages(body)) {
    const ev = toAgentEvent(msg);
    if (ev) yield ev;
  }
}

/**
 * Map a raw SSE message to a typed AgentEvent.
 *
 * The JSON payload's `type` is authoritative; the SSE event-name
 * field is a fallback when the payload omits it. Anything that
 * doesn't match the AgentEvent union is logged + dropped — silent
 * drops have bitten us before, so be loud.
 */
function toAgentEvent(msg: EventSourceMessage): AgentEvent | null {
  if (!msg.data) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(msg.data);
  } catch (err) {
    console.warn("[catalyst-llm-sdk] dropped malformed SSE data", {
      event: msg.event,
      data: msg.data.slice(0, 200),
      err,
    });
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : msg.event;
  if (!type) {
    console.warn("[catalyst-llm-sdk] dropped SSE message with no type", obj);
    return null;
  }
  if (!isAgentEventType(type)) {
    console.warn(
      `[catalyst-llm-sdk] dropped unknown agent event type "${type}"`,
      obj,
    );
    return null;
  }
  return { ...obj, type } as AgentEvent;
}
