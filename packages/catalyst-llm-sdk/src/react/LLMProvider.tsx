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
  LiteLLMModelSource,
  type ChatParams,
  type LLMConfigInit,
  type ModelSource,
} from "../client/index.js";
import { CatalystAgentClient } from "../agent/index.js";
import { useChatStore } from "./chat/index.js";
import { usePromptStore } from "./promptStore.js";

interface LLMContextValue {
  client: CatalystLLMClient;
  /**
   * Agent backend (catalyst-langgraph). chatStore.sendMessage routes
   * through this; the legacy direct-LiteLLM `client` is retained
   * for non-chat methods (model listing, embeddings) that haven't
   * been migrated yet. Followup llm-61f tracks dropping `client`
   * from the React layer entirely.
   */
  agentClient: CatalystAgentClient | null;
  /**
   * Strategy that ``useModels()`` consults for the catalogue. Defaults
   * to ``LiteLLMModelSource(client)``. Hosts override to point at
   * Ollama, a static list, an HTTP proxy, etc. with one prop change.
   */
  modelSource: ModelSource;
}

const LLMContext = createContext<LLMContextValue | null>(null);

export interface LLMProviderProps {
  children: ReactNode;
  /** Pre-built client; if omitted, one is constructed from `config` or env. */
  client?: CatalystLLMClient;
  /** Used only when `client` is not provided. */
  config?: LLMConfig | LLMConfigInit;
  /**
   * Pre-built agent client (catalyst-langgraph). When provided, all
   * chat sends route through it instead of the direct-LiteLLM path on
   * `client`. Required for tool use post-migration; non-tool chats
   * also work without it but will surface an error.
   */
  agentClient?: CatalystAgentClient;
  /** Default model selected for new chats. */
  defaultModel?: string;
  /** Default sampling parameters for new chats. */
  defaultParams?: ChatParams;
  /** Default system prompt for new chats. */
  defaultSystemPrompt?: string;
  /**
   * Strategy for the model catalogue (op-m6t). When omitted, defaults
   * to ``LiteLLMModelSource(client)`` (legacy behaviour). Hosts pass
   * ``new OllamaModelSource()``, ``new StaticModelSource([...])``,
   * ``new HttpModelSource('/api/agent/models')``, or any custom
   * ``ModelSource`` impl to swap.
   *
   * Hot-swappable: pass a new instance and useModels() re-fetches on
   * the next refresh.
   */
  modelSource?: ModelSource;
}

export function LLMProvider({
  children,
  client,
  config,
  agentClient,
  defaultModel,
  defaultParams,
  defaultSystemPrompt,
  modelSource,
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
    useChatStore.getState().setAgentClient(agentClient ?? null);
  }, [agentClient]);

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
    void import("../components/prompts/prompt-seeds.js").then((m) => {
      if (cancelled) return;
      usePromptStore.getState().seedBuiltins(m.BUILTIN_SEEDS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedModelSource = useMemo<ModelSource>(
    () => modelSource ?? new LiteLLMModelSource(resolvedClient),
    [modelSource, resolvedClient],
  );

  const value = useMemo<LLMContextValue>(
    () => ({
      client: resolvedClient,
      agentClient: agentClient ?? null,
      modelSource: resolvedModelSource,
    }),
    [resolvedClient, agentClient, resolvedModelSource],
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
