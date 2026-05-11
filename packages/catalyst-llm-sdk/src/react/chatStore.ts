import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  CatalystLLMClient,
  ChatParams,
  Message,
  StreamMeta,
  ToolCall,
  ToolDefinition,
  ToolRegistryLike,
} from "../client/index.js";

/**
 * Return a ToolRegistryLike adapter that wraps `source` but only
 * exposes tools whose name is in `allowed`. Used per-request to
 * narrow the shared registry to a chat's `enabledTools` opt-in
 * without mutating the source registry.
 */
function toolRegistryFiltered(
  source: ToolRegistryLike,
  allowed: readonly string[],
): ToolRegistryLike {
  const allow = new Set(allowed);
  return {
    has: (name) => allow.has(name) && source.has(name),
    list: () => source.list().filter((t: ToolDefinition) => allow.has(t.name)),
    toOpenAI: () =>
      source.toOpenAI().filter((t) => allow.has(t.function.name)),
    invoke: async (name, args, ctx) => {
      if (!allow.has(name)) {
        throw new Error(`tool ${name} not enabled for this chat`);
      }
      return source.invoke(name, args, ctx);
    },
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
   * Optional tool registry shared across chats. When set, individual
   * chats can opt into tool calls via `enabledTools`. The store calls
   * the registry's `invoke` method during sendMessage's onToolCall.
   */
  tools: ToolRegistryLike | null;
  defaultModel: string;
  defaultParams: ChatParams;
  defaultSystemPrompt: string;

  chats: Chat[];
  activeChat: string;
  abortControllers: Map<string, AbortController>;

  // Setup (called by LLMProvider on mount)
  setClient: (client: CatalystLLMClient) => void;
  setTools: (tools: ToolRegistryLike | null) => void;
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
  defaultModel: "",
  defaultParams: INITIAL_PARAMS,
  defaultSystemPrompt: INITIAL_SYSTEM_PROMPT,
  tools: null,

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

  setTools: (tools) => set({ tools }),

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
    const client = state.client;
    if (!client) {
      get().setError(chatId, "No CatalystLLMClient configured");
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

    const messages: Message[] = [];
    if (chat.systemPrompt) {
      messages.push({ role: "system", content: chat.systemPrompt });
    }
    for (const msg of chat.messages) {
      if (msg.role !== "system") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content });

    const ctrl = new AbortController();
    state.abortControllers.set(chatId, ctrl);

    // Build a per-request tool view: the global registry, narrowed to
    // the names this chat opted into. Skipping when no registry is
    // bound or no tools are enabled keeps non-tool chats on the same
    // wire shape they had before this feature shipped.
    const enabledNames = chat.enabledTools ?? [];
    const sharedTools = state.tools;
    const toolsForRequest =
      sharedTools && enabledNames.length > 0
        ? toolRegistryFiltered(sharedTools, enabledNames)
        : undefined;

    try {
      const stream = client.streamChat({
        model: chat.model,
        messages,
        params: chat.params,
        signal: ctrl.signal,
        tools: toolsForRequest,
        onToolCall: (event) => {
          // Append the tool call onto the *current* assistant turn so
          // the chat UI can render <ToolCallCard>s inline. We persist
          // the call+result so it survives reload.
          set((s) => ({
            chats: s.chats.map((c) => {
              if (c.id !== chatId) return c;
              const last = c.messages[c.messages.length - 1];
              if (!last || last.role !== "assistant") return c;
              const record: ChatToolCallRecord = {
                call: event.call,
                args: event.args,
                result: event.result,
                error: event.error,
                duration_ms: event.duration_ms,
                iteration: event.iteration,
                finished_at: Date.now(),
              };
              const merged = [...c.messages.slice(0, -1), {
                ...last,
                tool_calls: [...(last.tool_calls ?? []), record],
              }];
              return { ...c, messages: merged };
            }),
          }));
        },
      });
      for await (const chunk of stream) {
        if (chunk.done) {
          // Intermediate done chunks happen between tool-call iterations
          // (the SDK emits one per loop turn so consumers can flush UI
          // state). Keep iterating until we see a done chunk without
          // tool_calls — that's the actual end of the assistant's turn.
          if (chunk.tool_calls && chunk.tool_calls.length > 0) continue;
          get().finishStreaming(chatId, chunk.meta);
          break;
        }
        if (!get().chats.find((c) => c.id === chatId)?.firstTokenTime) {
          get().setFirstTokenTime(chatId);
        }
        get().appendToken(chatId, chunk.delta, chunk.meta);
      }
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError") {
        get().finishStreaming(chatId, { finish_reason: "abort" });
      } else {
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
