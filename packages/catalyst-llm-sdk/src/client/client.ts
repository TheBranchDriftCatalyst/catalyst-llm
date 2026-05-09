import { LLMConfig, type LLMConfigInit } from "./config.js";
import { getEndpointInfo } from "./endpoints.js";
import { effectiveMetadata } from "./modelHints.js";
import { parseSSEChunks } from "./streaming.js";
import type {
  ChatChunk,
  ChatParams,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  Model,
  ModelInfo,
  ModelWithRouting,
} from "./types.js";

const MODELS_CACHE_TTL_MS = 30_000;

export class CatalystLLMClient {
  readonly config: LLMConfig;

  /**
   * Lazy cache of getModelsWithRouting() output, used by the request-time
   * params filter. We don't want every chat completion to round-trip to
   * /v1/models + /model/info, so we cache for 30s. Cache misses fall back
   * to "pass through unfiltered" — better to send a request that might
   * fail than to block the user.
   */
  private _modelsCache: { ts: number; data: ModelWithRouting[] } | null = null;

  constructor(config?: LLMConfig | LLMConfigInit) {
    this.config = config instanceof LLMConfig ? config : new LLMConfig(config);
  }

  private get baseHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...this.config.authHeader,
    };
  }

  private async _getModelsCached(): Promise<ModelWithRouting[]> {
    const now = Date.now();
    if (this._modelsCache && now - this._modelsCache.ts < MODELS_CACHE_TTL_MS) {
      return this._modelsCache.data;
    }
    try {
      const data = await this.getModelsWithRouting();
      this._modelsCache = { ts: now, data };
      return data;
    } catch {
      // Don't fail the chat just because /model/info is flaky — return
      // whatever the previous cache held (even if stale) or empty.
      return this._modelsCache?.data ?? [];
    }
  }

  /**
   * Strips request params that the target model can't actually handle.
   *
   * Currently: drops `reasoning_effort` when the model's effective
   * metadata explicitly says `supports_reasoning === false`. This catches
   * the case where a chat carries a stale reasoning_effort value (from a
   * previous reasoning-capable model) and the user switches to a
   * community Ollama quant whose Modelfile lacks the thinking template
   * — Ollama would otherwise 500 with `<tag> does not support thinking`.
   *
   * Unknown models (no rule match, no metadata) pass through unfiltered:
   * we'd rather let an experimental model see all params than over-strip
   * and silently degrade behavior.
   */
  private async _filterParamsForModel(
    modelId: string,
    params: ChatParams | undefined,
  ): Promise<ChatParams | undefined> {
    if (!params || params.reasoning_effort === undefined) return params;
    const models = await this._getModelsCached();
    const model = models.find((m) => m.id === modelId);
    const meta = effectiveMetadata(model);
    if (meta.supports_reasoning === false) {
      const { reasoning_effort: _stripped, ...rest } = params;
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          `[catalyst-llm-sdk] dropped reasoning_effort=${_stripped} for ` +
            `${modelId} — model doesn't support thinking template`,
        );
      }
      return rest;
    }
    return params;
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
      return {
        ...m,
        endpoint: getEndpointInfo(apiBase),
        metadata: meta?.model_info,
        underlyingModel: meta?.litellm_params?.model,
      };
    });
  }

  async createChat(req: ChatRequest): Promise<ChatResponse> {
    const params = await this._filterParamsForModel(req.model, req.params);
    const resp = await this.config.fetchImpl(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.baseHeaders,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: false,
          ...(params ?? {}),
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
    const filterParams = (m: string, p: ChatParams | undefined) =>
      this._filterParamsForModel(m, p);
    return {
      [Symbol.asyncIterator]: async function* () {
        const params = await filterParams(req.model, req.params);
        const resp = await config.fetchImpl(
          `${config.baseUrl}/v1/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: req.model,
              messages: req.messages,
              stream: true,
              // OpenAI/LiteLLM omit `usage` from streamed chunks by default.
              // Without this opt-in, downstream consumers see TTFT/RT (which
              // come from local timestamps) but `prompt_tokens` /
              // `completion_tokens` / cost stay at zero. Caller-supplied
              // `params.stream_options` always wins.
              stream_options: { include_usage: true },
              ...(params ?? {}),
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
