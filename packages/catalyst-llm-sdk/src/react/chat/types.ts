/**
 * chatStore data types — Chat, ChatTurn, tool-call records, sub-events.
 * Lives in its own file so anything that just wants the type shape
 * (panels, viewers, exporters) can import without pulling in the
 * Zustand create() call's transitive dependencies.
 */
import { nanoid } from "nanoid";
import type { ChatParams, StreamMeta, CatalystLLMClient } from "../../client/index.js";
import type { CatalystAgentClient } from "../../agent/index.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * One tool invocation captured during a streaming turn. We store the
 * call (so the assistant message has provenance), the parsed args, and
 * either the JSON result or an error string. ToolCallCard reads this
 * shape directly. Persisted with the chat so a refresh keeps the
 * tool-call history.
 */
/**
 * One sub-event that happened INSIDE a tool's execution — a council
 * member's token, a critic's structured-output line, a nested
 * tool_call_start/end, etc. The backend tags such events with
 * `owner_tool_id`; chatStore routes them here so the ToolCallCard
 * can render an expandable "reasoning" section per tool call
 * instead of leaking them into the parent assistant bubble.
 *
 * Discriminated by `kind` so the renderer can switch over shapes
 * without sniffing structure. Kept minimal — we only carry the
 * fields the UI actually displays.
 */
export type ToolSubEvent =
  | { kind: "token"; content: string }
  | { kind: "reasoning"; content: string }
  | { kind: "iteration"; n: number }
  | {
      kind: "tool_call_start";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      kind: "tool_call_end";
      id: string;
      result?: unknown;
      error?: string;
      duration_ms: number;
    };

export interface ChatToolCallRecord {
  call: ToolCall;
  args: unknown;
  result?: unknown;
  error?: string;
  duration_ms: number;
  /** Iteration index within the streamChat tool-call loop (0-based). */
  iteration: number;
  /** Wall-clock when the call resolved (used for ordering + display). */
  finished_at: number;
  /**
   * Events emitted by inner LLMs / nested tools while THIS tool was
   * running. The ToolCallCard renders these in a collapsible
   * "reasoning" dropdown so the operator can drill into sub-agent
   * activity (council members, critic, fusion) without it
   * polluting the parent chat bubble. Empty / undefined when the
   * tool had no nested activity (e.g. plain `web_search` calls).
   */
  sub_events?: ToolSubEvent[];
}

export interface ChatTurn {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
  meta?: StreamMeta;
  /**
   * Tool calls invoked by the model on this assistant turn. May be
   * empty / undefined when the turn was a plain reply. Multiple calls
   * accumulate across the multi-iteration tool loop.
   */
  tool_calls?: ChatToolCallRecord[];
  /**
   * Error from the backend that aborted this assistant turn (the
   * SSE `error` event, or a fetch failure). Rendered inline inside
   * the assistant bubble so the failed turn carries its own context
   * instead of pointing at a separate banner. Mutually exclusive
   * with a successful `content` — though we keep both so partial
   * text that streamed before the error stays visible.
   */
  error?: string;
}

export interface Chat {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  params: ChatParams;
  messages: ChatTurn[];
  isStreaming: boolean;
  error?: string;
  /**
   * Names of tools (from the LLMProvider's ToolRegistry) the model is
   * allowed to invoke on this chat. `undefined` = no tools (default,
   * for backward compat with chats that pre-date tools). `[]` = also no
   * tools (explicit). A non-empty array opts each name in.
   */
  enabledTools?: string[];
  /** Wall-clock time the most-recent request was dispatched. */
  streamStartTime?: number;
  /** Wall-clock time the first token of the latest response arrived (TTFT base). */
  firstTokenTime?: number;
  /** Wall-clock time the latest stream finished (used for tok/s). */
  streamEndTime?: number;
  /**
   * Set when a stream was killed by a page refresh / unmount before it could
   * finish. The last assistant message holds whatever partial text arrived;
   * `resumeChat(id)` will discard it and re-issue from the prior user turn.
   */
  interrupted?: boolean;
}

export interface ChatStore {
  client: CatalystLLMClient | null;
  /**
   * Agent backend (catalyst-langgraph). When set, sendMessage routes
   * through the Python LangGraph service instead of calling the
   * LiteLLM proxy directly. The TS-side tool loop is gone — the
   * agent loop runs server-side and emits typed AgentEvents.
   */
  agentClient: CatalystAgentClient | null;
  defaultModel: string;
  defaultParams: ChatParams;
  defaultSystemPrompt: string;

  chats: Chat[];
  activeChat: string;
  abortControllers: Map<string, AbortController>;

  // Setup (called by LLMProvider on mount)
  setClient: (client: CatalystLLMClient) => void;
  setAgentClient: (client: CatalystAgentClient | null) => void;
  setEnabledTools: (chatId: string, names: string[]) => void;
  setDefaults: (init: {
    model?: string;
    params?: ChatParams;
    systemPrompt?: string;
  }) => void;

  // Chat management
  addChat: () => string;
  removeChat: (id: string) => void;
  setActiveChat: (id: string) => void;
  renameChat: (id: string, name: string) => void;
  clearChat: (id: string) => void;

  // Chat settings
  setModel: (chatId: string, model: string) => void;
  setSystemPrompt: (chatId: string, prompt: string) => void;
  setParams: (chatId: string, params: Partial<ChatParams>) => void;

  // Messages
  sendMessage: (chatId: string, content: string) => Promise<void>;
  /**
   * Re-issue the last user turn for a chat that was interrupted (e.g. by a
   * page refresh). Drops the partial assistant message that was killed
   * mid-stream, then re-runs sendMessage with the user's prior input. No-op
   * if the chat isn't actually interrupted or the prior turn wasn't a user
   * message.
   */
  resumeChat: (chatId: string) => Promise<void>;
  stopStreaming: (chatId: string) => void;
  appendToken: (chatId: string, token: string, meta?: StreamMeta) => void;
  setFirstTokenTime: (chatId: string) => void;
  setError: (chatId: string, error: string | undefined) => void;
  /**
   * Attach an error message to the last assistant turn in the chat
   * (the one the current stream is filling). Used by the SSE `error`
   * event so failures appear inline in the conversation instead of
   * only on a chat-level banner.
   */
  setTurnError: (chatId: string, error: string) => void;
  finishStreaming: (chatId: string, meta?: StreamMeta) => void;
}

export function createDefaultChat(
  defaults: { model: string; params: ChatParams; systemPrompt: string },
  id?: string,
): Chat {
  return {
    id: id || nanoid(8),
    name: "New Chat",
    model: defaults.model,
    systemPrompt: defaults.systemPrompt,
    params: { ...defaults.params },
    messages: [],
    isStreaming: false,
  };
}

export const INITIAL_PARAMS: ChatParams = {
  temperature: 0.7,
  max_tokens: 2048,
  top_p: 1.0,
};

export const INITIAL_SYSTEM_PROMPT = "You are a helpful assistant.";
