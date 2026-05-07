import { LLMConfig, type LLMConfigInit } from "./config.js";
import { getEndpointInfo } from "./endpoints.js";
import { parseSSEChunks } from "./streaming.js";
import type {
  ChatChunk,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  Model,
  ModelInfo,
  ModelWithRouting,
} from "./types.js";

export class CatalystLLMClient {
  readonly config: LLMConfig;

  constructor(config?: LLMConfig | LLMConfigInit) {
    this.config = config instanceof LLMConfig ? config : new LLMConfig(config);
  }

  private get baseHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...this.config.authHeader,
    };
  }

  async verifyConnection(timeoutMs = 5000): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await this.config.fetchImpl(
        `${this.config.baseUrl}/v1/models`,
        { headers: this.baseHeaders, signal: ctrl.signal },
      );
      clearTimeout(t);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<Model[]> {
    const resp = await this.config.fetchImpl(
      `${this.config.baseUrl}/v1/models`,
      { headers: this.baseHeaders },
    );
    if (!resp.ok) {
      throw new Error(`getModels failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as { data?: Model[] };
    return data.data ?? [];
  }

  async getModelInfo(): Promise<ModelInfo[]> {
    try {
      const resp = await this.config.fetchImpl(
        `${this.config.baseUrl}/model/info`,
        { headers: this.baseHeaders },
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as { data?: ModelInfo[] };
      return data.data ?? [];
    } catch {
      return [];
    }
  }

  async getModelsWithRouting(): Promise<ModelWithRouting[]> {
    const [models, info] = await Promise.all([
      this.getModels(),
      this.getModelInfo(),
    ]);
    const infoMap = new Map(info.map((m) => [m.model_name, m]));
    return models.map((m) => {
      const meta = infoMap.get(m.id);
      const apiBase = meta?.litellm_params?.api_base;
      return { ...m, endpoint: getEndpointInfo(apiBase) };
    });
  }

  async createChat(req: ChatRequest): Promise<ChatResponse> {
    const resp = await this.config.fetchImpl(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.baseHeaders,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: false,
          ...(req.params ?? {}),
        }),
        signal: req.signal,
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`createChat failed: ${resp.status} ${text}`);
    }
    return (await resp.json()) as ChatResponse;
  }

  streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const config = this.config;
    const headers = this.baseHeaders;
    return {
      [Symbol.asyncIterator]: async function* () {
        const resp = await config.fetchImpl(
          `${config.baseUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: req.model,
              messages: req.messages,
              stream: true,
              ...(req.params ?? {}),
            }),
            signal: req.signal,
          },
        );
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`streamChat failed: ${resp.status} ${text}`);
        }
        yield* parseSSEChunks(resp);
      },
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const resp = await this.config.fetchImpl(
      `${this.config.baseUrl}/v1/embeddings`,
      {
        method: "POST",
        headers: this.baseHeaders,
        body: JSON.stringify({ model: req.model, input: req.input }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`embed failed: ${resp.status} ${text}`);
    }
    return (await resp.json()) as EmbedResponse;
  }
}
