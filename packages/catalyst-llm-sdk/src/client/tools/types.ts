/**
 * Tool / function-calling primitives. These types align with OpenAI's
 * `tools` API surface (the wire format LiteLLM forwards to every
 * provider) so a registry's output can be passed straight into the
 * request body without a translation layer.
 *
 * The "MCP-like" framing: a tool is a name + JSON schema + a handler
 * that runs *somewhere*. Where it runs is the registry's concern —
 * a tool can be a pure browser-side function (e.g. crypto, math), or
 * it can call into a remote tool-host via HTTP (web search, headless
 * browser, file ops). Either way the signature is identical, so the
 * streaming loop in `client.streamChat` doesn't have to care.
 */

/** OpenAI-compat JSON-schema-ish parameters object. */
export type ToolParameters = Record<string, unknown>;

/**
 * Per-call context passed to handlers. Lets remote handlers honor
 * abort signals + lets the registry log which chat/turn triggered a
 * tool call without each handler re-deriving that.
 */
export interface ToolContext {
  signal?: AbortSignal;
  /** Identity of the chat/turn that triggered the call (best-effort). */
  origin?: {
    chat_id?: string;
    turn_id?: string;
    model?: string;
  };
}

export interface ToolHandler<TArgs = unknown, TResult = unknown> {
  (args: TArgs, ctx: ToolContext): Promise<TResult>;
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  /** The name LLMs see and reference in tool_calls. snake_case_recommended. */
  name: string;
  /** What the tool does — the LLM uses this to decide when to call it. */
  description: string;
  /**
   * JSON schema for the tool's argument object. Required even when the
   * tool takes no args (use `{ type: "object", properties: {} }`).
   */
  parameters: ToolParameters;
  /** Run the tool. Errors propagate as `role: "tool"` content with `error: ...`. */
  handler: ToolHandler<TArgs, TResult>;
  /** Optional grouping for UIs (e.g. "web", "browser", "fs"). */
  category?: string;
  /**
   * `transport` is informational metadata that the playground / UI can
   * use to label tools. The handler is what actually runs — this just
   * tags whether the tool's side effects happen in the host (browser /
   * Node / etc.) or via a remote service.
   */
  transport?: "browser" | "remote" | "system";
}

/**
 * The OpenAI wire-format tool entry, produced by ToolRegistry.toOpenAI().
 * Match exactly so we can spread into a request body unchanged.
 */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: ToolParameters;
  };
}

/**
 * A single tool invocation from the model's response. Mirrors the
 * OpenAI `tool_calls[]` entry — `arguments` is a JSON-encoded string,
 * intentionally, since the model emits it that way.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Raised when registry lookup or handler invocation fails. */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly toolName?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Subset of ToolRegistry that `client.streamChat` actually depends on.
 * Letting the request param accept this shape (rather than the full
 * class) lets hosts swap in mock registries for tests / sandboxes.
 */
export interface ToolRegistryLike {
  has(name: string): boolean;
  toOpenAI(): OpenAITool[];
  invoke(name: string, args: unknown, ctx: ToolContext): Promise<unknown>;
  list(): ToolDefinition[];
}

/**
 * Event fired via the `onToolCall` callback after each invocation
 * finishes. The chat panel uses these to render <ToolCallCard>s; the
 * dev metrics sink uses them to log tool latency / success rate.
 */
export interface ToolCallEvent {
  call: ToolCall;
  /** Parsed args (JSON.parse of call.function.arguments) — null on parse failure. */
  args: unknown;
  /** Result returned by the handler, or `undefined` on error. */
  result?: unknown;
  /** Set when the handler threw. */
  error?: string;
  /** Wall-clock duration of the handler call in ms. */
  duration_ms: number;
  /** Iteration number within the tool-call loop (0-based). */
  iteration: number;
}
