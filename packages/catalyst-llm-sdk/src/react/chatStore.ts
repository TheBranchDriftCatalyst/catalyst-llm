import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  CatalystLLMClient,
  ChatParams,
  StreamMeta,
} from "../client/index.js";
import type { CatalystAgentClient } from "../agent/index.js";
import { useEngineStore } from "./engineStore.js";

/**
 * OpenAI-shape tool_calls[] entry. We carry it on ChatToolCallRecord
 * so the existing ToolCallCard UI keeps working unchanged. The agent
 * backend doesn't emit this shape directly anymore — chatStore
 * synthesises one from tool_call_start events for UI consumption.
 */
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

interface ChatStore {
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

function createDefaultChat(
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

const INITIAL_PARAMS: ChatParams = {
  temperature: 0.7,
  max_tokens: 2048,
  top_p: 1.0,
};

const INITIAL_SYSTEM_PROMPT = "You are a helpful assistant.";

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
  client: null,
  agentClient: null,
  defaultModel: "",
  defaultParams: INITIAL_PARAMS,
  defaultSystemPrompt: INITIAL_SYSTEM_PROMPT,

  chats: [
    createDefaultChat({
      model: "",
      params: INITIAL_PARAMS,
      systemPrompt: INITIAL_SYSTEM_PROMPT,
    }),
  ],
  activeChat: "",
  abortControllers: new Map(),

  setClient: (client) => set({ client }),

  setAgentClient: (agentClient) => set({ agentClient }),

  setEnabledTools: (chatId, names) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, enabledTools: [...names] } : c,
      ),
    })),

  setDefaults: ({ model, params, systemPrompt }) =>
    set((state) => ({
      defaultModel: model ?? state.defaultModel,
      defaultParams: params ?? state.defaultParams,
      defaultSystemPrompt: systemPrompt ?? state.defaultSystemPrompt,
    })),

  addChat: () => {
    const state = get();
    const newChat = createDefaultChat({
      model: state.defaultModel,
      params: state.defaultParams,
      systemPrompt: state.defaultSystemPrompt,
    });
    set((s) => ({
      chats: [...s.chats, newChat],
      activeChat: newChat.id,
    }));
    return newChat.id;
  },

  removeChat: (id) => {
    const state = get();
    if (state.chats.length <= 1) return;
    const index = state.chats.findIndex((c) => c.id === id);
    const newChats = state.chats.filter((c) => c.id !== id);
    let newActive = state.activeChat;
    if (state.activeChat === id) {
      newActive = newChats[Math.min(index, newChats.length - 1)]?.id || "";
    }
    set({ chats: newChats, activeChat: newActive });
  },

  setActiveChat: (id) => set({ activeChat: id }),

  renameChat: (id, name) =>
    set((state) => ({
      chats: state.chats.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  clearChat: (id) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === id ? { ...c, messages: [], error: undefined } : c,
      ),
    })),

  setModel: (chatId, model) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, model, name: model || "New Chat" } : c,
      ),
    })),

  setSystemPrompt: (chatId, prompt) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, systemPrompt: prompt } : c,
      ),
    })),

  setParams: (chatId, params) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, params: { ...c.params, ...params } } : c,
      ),
    })),

  sendMessage: async (chatId, content) => {
    const state = get();
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat || !chat.model) return;
    const agentClient = state.agentClient;
    if (!agentClient) {
      get().setError(
        chatId,
        "No CatalystAgentClient configured — set VITE_AGENT_URL and pass agentClient to <LLMProvider>.",
      );
      return;
    }

    const userMessage: ChatTurn = {
      id: nanoid(8),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    const assistantMessage: ChatTurn = {
      id: nanoid(8),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };

    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, userMessage, assistantMessage],
              isStreaming: true,
              error: undefined,
              streamStartTime: Date.now(),
              firstTokenTime: undefined,
              streamEndTime: undefined,
            }
          : c,
      ),
    }));

    // Build the request body in the shape catalyst-langgraph expects.
    // System prompt is sent separately so the backend can prepend it
    // idempotently on every tool-loop iteration; per-chat history is
    // forwarded verbatim so the agent has full context.
    const history = chat.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content });

    const ctrl = new AbortController();
    state.abortControllers.set(chatId, ctrl);

    // Tracks tool calls in flight by event.id so tool_call_end events
    // can patch their matching record (instead of double-appending).
    const recordIndex = new Map<string, number>();
    let iteration = 0;

    // Pull the live Engine-tab config so any operator-edited Agent
    // tunables (researcher model, recursion limit, system prompts,
    // …) ride along with this request. The store returns undefined
    // when nothing has been edited, keeping the wire payload
    // byte-identical to today's traffic for users who never visit
    // the Engine tab.
    const agentConfig = useEngineStore.getState().asRequestPayload();

    try {
      const stream = agentClient.streamAgent(
        {
          model: chat.model,
          messages: history,
          system_prompt: chat.systemPrompt || undefined,
          tools: chat.enabledTools && chat.enabledTools.length > 0
            ? chat.enabledTools
            : undefined,
          params: chat.params as Record<string, unknown>,
          agent_config: agentConfig,
        },
        { signal: ctrl.signal },
      );

      for await (const ev of stream) {
        switch (ev.type) {
          case "run_started": {
            // Stash run_id on the assistant turn's meta for traceability.
            set((s) => ({
              chats: s.chats.map((c) => {
                if (c.id !== chatId) return c;
                const msgs = [...c.messages];
                const last = msgs[msgs.length - 1];
                if (last?.role !== "assistant") return c;
                msgs[msgs.length - 1] = {
                  ...last,
                  meta: { ...(last.meta ?? {}), id: ev.run_id, model: ev.model },
                };
                return { ...c, messages: msgs };
              }),
            }));
            break;
          }
          case "iteration":
            iteration = ev.n;
            break;
          case "token":
          case "reasoning": {
            // Both flow into the assistant's content. Reasoning
            // segments are recognised + collapsed downstream by
            // ChatMessage's splitReasoning() — the wire format
            // doesn't need to differentiate yet.
            if (!get().chats.find((c) => c.id === chatId)?.firstTokenTime) {
              get().setFirstTokenTime(chatId);
            }
            get().appendToken(chatId, ev.content);
            break;
          }
          case "tool_call_start": {
            // Append a placeholder ChatToolCallRecord so ToolCallCard
            // can render an in-flight state immediately. We reconstruct
            // the OpenAI-shape `call` field so the existing UI keeps
            // working unchanged.
            const placeholder: ChatToolCallRecord = {
              call: {
                id: ev.id,
                type: "function",
                function: {
                  name: ev.name,
                  arguments: JSON.stringify(ev.args ?? {}),
                },
              } as unknown as ToolCall,
              args: ev.args,
              duration_ms: 0,
              iteration,
              finished_at: 0,
            };
            set((s) => ({
              chats: s.chats.map((c) => {
                if (c.id !== chatId) return c;
                const msgs = [...c.messages];
                const last = msgs[msgs.length - 1];
                if (last?.role !== "assistant") return c;
                const next = {
                  ...last,
                  tool_calls: [...(last.tool_calls ?? []), placeholder],
                };
                msgs[msgs.length - 1] = next;
                recordIndex.set(ev.id, (next.tool_calls!.length - 1));
                return { ...c, messages: msgs };
              }),
            }));
            break;
          }
          case "tool_call_end": {
            // Patch the placeholder created at tool_call_start. If we
            // somehow missed the start (race / reorder) we just append
            // a record with what we have — better than dropping it.
            set((s) => ({
              chats: s.chats.map((c) => {
                if (c.id !== chatId) return c;
                const msgs = [...c.messages];
                const last = msgs[msgs.length - 1];
                if (last?.role !== "assistant") return c;
                const idx = recordIndex.get(ev.id);
                const calls = [...(last.tool_calls ?? [])];
                if (idx !== undefined && calls[idx]) {
                  calls[idx] = {
                    ...calls[idx],
                    result: ev.result,
                    error: ev.error,
                    duration_ms: ev.duration_ms,
                    finished_at: Date.now(),
                  };
                } else {
                  calls.push({
                    call: {
                      id: ev.id,
                      type: "function",
                      function: { name: "", arguments: "" },
                    } as unknown as ToolCall,
                    args: undefined,
                    result: ev.result,
                    error: ev.error,
                    duration_ms: ev.duration_ms,
                    iteration,
                    finished_at: Date.now(),
                  });
                }
                msgs[msgs.length - 1] = { ...last, tool_calls: calls };
                return { ...c, messages: msgs };
              }),
            }));
            break;
          }
          case "message_done": {
            const meta: StreamMeta = {};
            if (ev.finish_reason) meta.finish_reason = ev.finish_reason;
            if (ev.usage) meta.usage = ev.usage as StreamMeta["usage"];
            get().finishStreaming(chatId, meta);
            return;
          }
          case "error": {
            // Attach the error to the assistant turn so the failed
            // bubble carries its own context. The chat-level banner
            // was easy to miss — and missing the failure mode is
            // exactly what made the SSE bug feel like "empty replies".
            get().setTurnError(chatId, ev.message);
            get().finishStreaming(chatId, { finish_reason: "error" });
            return;
          }
        }
      }
      // Stream ended without a message_done (rare — backend should always
      // emit it). Treat as a clean finish so UI doesn't get stuck.
      get().finishStreaming(chatId);
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError") {
        get().finishStreaming(chatId, { finish_reason: "abort" });
      } else {
        // Network / fetch failure — no assistant turn body to attach
        // to. Fall back to the chat-level banner so it still surfaces.
        get().setError(chatId, err.message);
        get().finishStreaming(chatId);
      }
    } finally {
      state.abortControllers.delete(chatId);
    }
  },

  resumeChat: async (chatId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat || !chat.interrupted) return;
    const messages = chat.messages;
    // The last message is the partial assistant turn. The one before it must
    // be the user input we're resuming. If the structure doesn't match, bail.
    const last = messages[messages.length - 1];
    const prior = messages[messages.length - 2];
    if (last?.role !== "assistant" || prior?.role !== "user") return;
    // Drop both — sendMessage will re-create them when it dispatches.
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: messages.slice(0, -2),
              interrupted: false,
              error: undefined,
            }
          : c,
      ),
    }));
    await get().sendMessage(chatId, prior.content);
  },

  stopStreaming: (chatId) => {
    const ctrl = get().abortControllers.get(chatId);
    if (ctrl) ctrl.abort();
  },

  appendToken: (chatId, token, meta) =>
    set((state) => ({
      chats: state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const messages = [...c.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "assistant") {
          messages[messages.length - 1] = {
            ...last,
            content: last.content + token,
            meta,
          };
        }
        return { ...c, messages };
      }),
    })),

  setFirstTokenTime: (chatId) =>
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, firstTokenTime: Date.now() } : c,
      ),
    })),

  setError: (chatId, error) =>
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chatId ? { ...c, error } : c)),
    })),

  setTurnError: (chatId, error) =>
    set((state) => ({
      chats: state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const messages = [...c.messages];
        const last = messages[messages.length - 1];
        if (last?.role !== "assistant") return c;
        messages[messages.length - 1] = { ...last, error };
        return { ...c, messages };
      }),
    })),

  finishStreaming: (chatId, meta) =>
    set((state) => ({
      chats: state.chats.map((c) => {
        if (c.id !== chatId) return c;
        const messages = [...c.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "assistant" && meta) {
          messages[messages.length - 1] = { ...last, meta };
        }
        return {
          ...c,
          messages,
          isStreaming: false,
          streamEndTime: Date.now(),
        };
      }),
    })),
    }),
    {
      name: "catalyst-llm-sdk:chat",
      storage: createJSONStorage(() => localStorage),
      // Persist conversations + per-chat config; skip non-serializable
      // (client, abortControllers) and skip transient streaming flags. After
      // a page refresh any chat marked `isStreaming: true` had its fetch
      // killed with the page — flip it back so the UI lets the user resume.
      partialize: (s) => ({
        chats: s.chats,
        activeChat: s.activeChat,
        defaultModel: s.defaultModel,
        defaultParams: s.defaultParams,
        defaultSystemPrompt: s.defaultSystemPrompt,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatStore>;
        const chats = (p.chats ?? []).map((c) =>
          c.isStreaming
            ? { ...c, isStreaming: false, interrupted: true }
            : c,
        );
        return {
          ...current,
          ...p,
          chats: chats.length > 0 ? chats : current.chats,
          abortControllers: new Map(),
        };
      },
    },
  ),
);

const initialState = useChatStore.getState();
if (!initialState.activeChat && initialState.chats.length > 0) {
  useChatStore.setState({ activeChat: initialState.chats[0].id });
}
