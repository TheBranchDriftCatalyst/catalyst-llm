import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  CatalystLLMClient,
  ChatParams,
  Message,
  StreamMeta,
} from "../client/index.js";

export interface ChatTurn {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
  meta?: StreamMeta;
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
  streamStartTime?: number;
  firstTokenTime?: number;
}

interface ChatStore {
  client: CatalystLLMClient | null;
  defaultModel: string;
  defaultParams: ChatParams;
  defaultSystemPrompt: string;

  chats: Chat[];
  activeChat: string;
  abortControllers: Map<string, AbortController>;

  // Setup (called by LLMProvider on mount)
  setClient: (client: CatalystLLMClient) => void;
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

export const useChatStore = create<ChatStore>((set, get) => ({
  client: null,
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

    try {
      const stream = client.streamChat({
        model: chat.model,
        messages,
        params: chat.params,
        signal: ctrl.signal,
      });
      for await (const chunk of stream) {
        if (chunk.done) {
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
        return { ...c, messages, isStreaming: false };
      }),
    })),
}));

const initialState = useChatStore.getState();
if (!initialState.activeChat && initialState.chats.length > 0) {
  useChatStore.setState({ activeChat: initialState.chats[0].id });
}
