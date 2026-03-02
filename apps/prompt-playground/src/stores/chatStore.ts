import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { streamClient, type StreamMeta } from '../lib/streamClient';
import type { Message, ChatParams } from '../lib/litellm';

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
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
  messages: ChatMessage[];
  isStreaming: boolean;
  error?: string;
  streamStartTime?: number;
  firstTokenTime?: number;
}

interface ChatStore {
  chats: Chat[];
  activeChat: string;

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

function createDefaultChat(id?: string): Chat {
  return {
    id: id || nanoid(8),
    name: 'New Chat',
    model: '',
    systemPrompt: 'You are a helpful assistant.',
    params: {
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 1.0,
    },
    messages: [],
    isStreaming: false,
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [createDefaultChat()],
  activeChat: '',

  addChat: () => {
    const newChat = createDefaultChat();
    set(state => ({
      chats: [...state.chats, newChat],
      activeChat: newChat.id,
    }));
    return newChat.id;
  },

  removeChat: (id: string) => {
    const state = get();
    if (state.chats.length <= 1) return;

    const index = state.chats.findIndex(c => c.id === id);
    const newChats = state.chats.filter(c => c.id !== id);

    let newActive = state.activeChat;
    if (state.activeChat === id) {
      newActive = newChats[Math.min(index, newChats.length - 1)]?.id || '';
    }

    set({ chats: newChats, activeChat: newActive });
  },

  setActiveChat: (id: string) => {
    set({ activeChat: id });
  },

  renameChat: (id: string, name: string) => {
    set(state => ({
      chats: state.chats.map(c => (c.id === id ? { ...c, name } : c)),
    }));
  },

  clearChat: (id: string) => {
    set(state => ({
      chats: state.chats.map(c =>
        c.id === id ? { ...c, messages: [], error: undefined } : c
      ),
    }));
  },

  setModel: (chatId: string, model: string) => {
    set(state => ({
      chats: state.chats.map(c =>
        c.id === chatId ? { ...c, model, name: model || 'New Chat' } : c
      ),
    }));
  },

  setSystemPrompt: (chatId: string, prompt: string) => {
    set(state => ({
      chats: state.chats.map(c =>
        c.id === chatId ? { ...c, systemPrompt: prompt } : c
      ),
    }));
  },

  setParams: (chatId: string, params: Partial<ChatParams>) => {
    set(state => ({
      chats: state.chats.map(c =>
        c.id === chatId ? { ...c, params: { ...c.params, ...params } } : c
      ),
    }));
  },

  sendMessage: async (chatId: string, content: string) => {
    const state = get();
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat || !chat.model) return;

    const userMessage: ChatMessage = {
      id: nanoid(8),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: nanoid(8),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    // Add messages and set streaming state
    set(state => ({
      chats: state.chats.map(c =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, userMessage, assistantMessage],
              isStreaming: true,
              error: undefined,
              streamStartTime: Date.now(),
              firstTokenTime: undefined,
            }
          : c
      ),
    }));

    // Build message history
    const messages: Message[] = [];
    if (chat.systemPrompt) {
      messages.push({ role: 'system', content: chat.systemPrompt });
    }
    for (const msg of chat.messages) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content });

    // Subscribe to stream
    const unsubscribe = streamClient.subscribe(chatId, (chunk, done, meta) => {
      if (done) {
        get().finishStreaming(chatId, meta);
      } else {
        if (!get().chats.find(c => c.id === chatId)?.firstTokenTime) {
          get().setFirstTokenTime(chatId);
        }
        get().appendToken(chatId, chunk, meta);
      }
    });

    try {
      await streamClient.stream(chatId, messages, chat.model, chat.params);
    } catch (error) {
      get().setError(chatId, (error as Error).message);
      get().finishStreaming(chatId);
    } finally {
      unsubscribe();
    }
  },

  stopStreaming: (chatId: string) => {
    streamClient.abort(chatId);
  },

  appendToken: (chatId: string, token: string, meta?: StreamMeta) => {
    set(state => ({
      chats: state.chats.map(c => {
        if (c.id !== chatId) return c;
        const messages = [...c.messages];
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMessage,
            content: lastMessage.content + token,
            meta,
          };
        }
        return { ...c, messages };
      }),
    }));
  },

  setFirstTokenTime: (chatId: string) => {
    set(state => ({
      chats: state.chats.map(c =>
        c.id === chatId ? { ...c, firstTokenTime: Date.now() } : c
      ),
    }));
  },

  setError: (chatId: string, error: string | undefined) => {
    set(state => ({
      chats: state.chats.map(c => (c.id === chatId ? { ...c, error } : c)),
    }));
  },

  finishStreaming: (chatId: string, meta?: StreamMeta) => {
    set(state => ({
      chats: state.chats.map(c => {
        if (c.id !== chatId) return c;
        const messages = [...c.messages];
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'assistant' && meta) {
          messages[messages.length - 1] = { ...lastMessage, meta };
        }
        return { ...c, messages, isStreaming: false };
      }),
    }));
  },
}));

// Initialize activeChat on first load
const initialState = useChatStore.getState();
if (!initialState.activeChat && initialState.chats.length > 0) {
  useChatStore.setState({ activeChat: initialState.chats[0].id });
}
