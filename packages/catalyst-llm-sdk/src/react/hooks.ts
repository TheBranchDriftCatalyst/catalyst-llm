import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentDescriptor } from "../agent/events.js";
import type {
  ChatParams,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  EndpointType,
  ModelWithRouting,
} from "../client/index.js";
import { useLLMContext } from "./LLMProvider.js";
import { useChatStore } from "./chatStore.js";

export function useLLM() {
  const { client } = useLLMContext();
  return client;
}

export interface AvailableTool {
  name: string;
  description: string;
}

export interface UseAvailableToolsResult {
  tools: AvailableTool[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetch the list of tools the agent backend will dispatch. Used by
 * the chat surface's tool-toggle popover. Returns [] when no
 * agentClient is configured (chat is then effectively tool-less,
 * matching the no-LLMProvider-tools state we used to support).
 */
export function useAvailableTools(): UseAvailableToolsResult {
  const { agentClient } = useLLMContext();
  const [tools, setTools] = useState<AvailableTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentClient) {
      setTools([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await agentClient.listTools();
      setTools(
        data.tools.map((t) => ({ name: t.name, description: t.description })),
      );
    } catch (e) {
      setError((e as Error).message);
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [agentClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tools, loading, error, refresh };
}

export interface UseAgentsResult {
  agents: AgentDescriptor[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetch the registry of Agents from catalyst-langgraph's GET /api/agents.
 * Used by the Engine tab to render a list of compiled graphs + their
 * topology + their config schemas. Returns [] when no agentClient is
 * configured.
 */
export function useAgents(): UseAgentsResult {
  const { agentClient } = useLLMContext();
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentClient) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await agentClient.listAgents();
      setAgents(data.agents);
    } catch (e) {
      setError((e as Error).message);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [agentClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}

export interface GroupedModels {
  mac: ModelWithRouting[];
  cluster: ModelWithRouting[];
  cloud: ModelWithRouting[];
}

export interface UseModelsResult {
  models: ModelWithRouting[];
  grouped: GroupedModels;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useModels(): UseModelsResult {
  const client = useLLM();
  const [models, setModels] = useState<ModelWithRouting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.getModelsWithRouting();
      setModels(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped: GroupedModels = useMemo(
    () => ({
      mac: models.filter((m) => m.endpoint?.type === ("mac" as EndpointType)),
      cluster: models.filter(
        (m) => m.endpoint?.type === ("cluster" as EndpointType),
      ),
      cloud: models.filter(
        (m) => m.endpoint?.type === ("cloud" as EndpointType),
      ),
    }),
    [models],
  );

  return { models, grouped, loading, error, refresh };
}

export interface UseChatResult {
  send: (content: string) => Promise<ChatResponse | null>;
  loading: boolean;
  error: string | null;
  data: ChatResponse | null;
}

/**
 * One-shot non-streaming chat. For streaming, use useStreamingChat or the
 * chat-store-driven UI components.
 */
export function useChat(
  init: { model: string; systemPrompt?: string; params?: ChatParams } = {
    model: "",
  },
): UseChatResult {
  const client = useLLM();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ChatResponse | null>(null);

  const send = useCallback(
    async (content: string) => {
      if (!init.model) {
        setError("No model selected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const messages = init.systemPrompt
          ? [
              { role: "system" as const, content: init.systemPrompt },
              { role: "user" as const, content },
            ]
          : [{ role: "user" as const, content }];
        const req: ChatRequest = {
          model: init.model,
          messages,
          params: init.params,
        };
        const resp = await client.createChat(req);
        setData(resp);
        return resp;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, init.model, init.systemPrompt, init.params],
  );

  return { send, loading, error, data };
}

export interface UseStreamingChatResult {
  send: (content: string) => Promise<void>;
  text: string;
  isStreaming: boolean;
  error: string | null;
  abort: () => void;
}

export function useStreamingChat(
  init: { model: string; systemPrompt?: string; params?: ChatParams } = {
    model: "",
  },
): UseStreamingChatResult {
  const client = useLLM();
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    ctrlRef.current?.abort();
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!init.model) {
        setError("No model selected");
        return;
      }
      setError(null);
      setText("");
      setIsStreaming(true);
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      try {
        const messages = init.systemPrompt
          ? [
              { role: "system" as const, content: init.systemPrompt },
              { role: "user" as const, content },
            ]
          : [{ role: "user" as const, content }];
        const stream = client.streamChat({
          model: init.model,
          messages,
          params: init.params,
          signal: ctrl.signal,
        });
        for await (const chunk of stream) {
          if (chunk.done) break;
          setText((prev) => prev + chunk.delta);
        }
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") setError(err.message);
      } finally {
        setIsStreaming(false);
        ctrlRef.current = null;
      }
    },
    [client, init.model, init.systemPrompt, init.params],
  );

  return { send, text, isStreaming, error, abort };
}

export interface UseEmbedResult {
  embed: (input: string | string[]) => Promise<EmbedResponse | null>;
  loading: boolean;
  error: string | null;
}

export function useEmbed(model: string): UseEmbedResult {
  const client = useLLM();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const embed = useCallback(
    async (input: string | string[]) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await client.embed({ model, input } as EmbedRequest);
        return resp;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, model],
  );

  return { embed, loading, error };
}

/** Re-export the chat store for components that need the multi-chat surface. */
export { useChatStore } from "./chatStore.js";
