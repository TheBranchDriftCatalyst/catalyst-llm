import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  CatalystLLMClient,
  LLMConfig,
  type ChatParams,
  type LLMConfigInit,
  type ToolRegistryLike,
} from "../client/index.js";
import { useChatStore } from "./chatStore.js";
import { usePromptStore } from "./promptStore.js";

interface LLMContextValue {
  client: CatalystLLMClient;
  /**
   * Optional tool registry shared with the chat store. Hosts that
   * pass it can let chats opt into individual tools via
   * `chatStore.setEnabledTools(chatId, [...])` without prop drilling.
   */
  tools: ToolRegistryLike | null;
}

const LLMContext = createContext<LLMContextValue | null>(null);

export interface LLMProviderProps {
  children: ReactNode;
  /** Pre-built client; if omitted, one is constructed from `config` or env. */
  client?: CatalystLLMClient;
  /** Used only when `client` is not provided. */
  config?: LLMConfig | LLMConfigInit;
  /** Default model selected for new chats. */
  defaultModel?: string;
  /** Default sampling parameters for new chats. */
  defaultParams?: ChatParams;
  /** Default system prompt for new chats. */
  defaultSystemPrompt?: string;
  /**
   * Optional ToolRegistry the chat store can dispatch tool calls into.
   * When set, individual chats opt into specific tool names via
   * `chatStore.setEnabledTools(chatId, [...])`. When unset, the chat
   * surface stays on the no-tools wire shape that pre-dates this
   * feature — backward-compatible.
   */
  tools?: ToolRegistryLike | null;
}

export function LLMProvider({
  children,
  client,
  config,
  defaultModel,
  defaultParams,
  defaultSystemPrompt,
  tools,
}: LLMProviderProps) {
  const clientRef = useRef<CatalystLLMClient | null>(null);

  const resolvedClient = useMemo(() => {
    if (client) return client;
    if (clientRef.current) return clientRef.current;
    const built = new CatalystLLMClient(config);
    clientRef.current = built;
    return built;
  }, [client, config]);

  useEffect(() => {
    useChatStore.getState().setClient(resolvedClient);
  }, [resolvedClient]);

  useEffect(() => {
    useChatStore.getState().setTools(tools ?? null);
  }, [tools]);

  useEffect(() => {
    useChatStore.getState().setDefaults({
      model: defaultModel,
      params: defaultParams,
      systemPrompt: defaultSystemPrompt,
    });
  }, [defaultModel, defaultParams, defaultSystemPrompt]);

  // Idempotently seed the prompt registry with the SDK's built-in
  // starters on first mount. Re-running is a no-op once the seeds are
  // present (matched by stable id), so this is safe to call on every
  // page load. We do it lazily here rather than in the store factory
  // so we don't import the (decently large) seed array unless the
  // host actually mounts an LLMProvider.
  useEffect(() => {
    let cancelled = false;
    void import("../components/PromptPresets.js").then((m) => {
      if (cancelled) return;
      usePromptStore.getState().seedBuiltins(m.BUILTIN_SEEDS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<LLMContextValue>(
    () => ({ client: resolvedClient, tools: tools ?? null }),
    [resolvedClient, tools],
  );

  return <LLMContext.Provider value={value}>{children}</LLMContext.Provider>;
}

export function useLLMContext(): LLMContextValue {
  const ctx = useContext(LLMContext);
  if (!ctx) {
    throw new Error("useLLMContext must be used within <LLMProvider>");
  }
  return ctx;
}
