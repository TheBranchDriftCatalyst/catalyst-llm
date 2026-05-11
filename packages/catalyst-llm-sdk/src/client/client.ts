import { LLMConfig, type LLMConfigInit } from "./config.js";
import { getEndpointInfo } from "./endpoints.js";
import { effectiveMetadata } from "./modelHints.js";
import { parseSSEChunks } from "./streaming.js";
import type {
  AssistantToolCall,
  ChatChunk,
  ChatParams,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  Message,
  Model,
  ModelInfo,
  ModelWithRouting,
  StreamMeta,
} from "./types.js";
import type {
  ToolCallEvent,
  ToolRegistryLike,
} from "./tools/types.js";

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
    const tools = req.tools;
    const maxIterations = req.max_tool_iterations ?? 5;
    const onToolCall = req.onToolCall;
    return {
      [Symbol.asyncIterator]: async function* () {
        // Working copy of the conversation — appended to between
        // tool-call iterations so each follow-up request sees the
        // assistant's tool_calls and the tool results.
        let messages: Message[] = [...req.messages];
        let iteration = 0;

        while (true) {
          const params = await filterParams(req.model, req.params);
          // When tools are registered we must request non-streaming.
          // LiteLLM+Ollama emit streaming tool calls as plain
          // `delta.content` chunks (the JSON gets built up char-by-char
          // in the text channel) instead of the `delta.tool_calls`
          // deltas the OpenAI spec calls for, so the stream parser
          // can never reconstruct a real tool_calls array. Non-streaming
          // returns a proper `message.tool_calls` field on the same
          // backends, so we use that whenever tools could fire.
          const hasTools = !!(tools && tools.list().length > 0);
          const body: Record<string, unknown> = {
            model: req.model,
            messages,
            stream: !hasTools,
            ...(hasTools ? {} : { stream_options: { include_usage: true } }),
            ...(params ?? {}),
          };
          if (hasTools) body.tools = tools!.toOpenAI();
          const resp = await config.fetchImpl(
            `${config.baseUrl}/v1/chat/completions`,
            {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: req.signal,
            },
          );
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`streamChat failed: ${resp.status} ${text}`);
          }

          // Forward chunks to the consumer in real time. We capture
          // the final chunk's tool_calls + content + meta separately
          // so we can decide whether to dispatch tools and loop.
          let assistantContent = "";
          let pendingCalls: AssistantToolCall[] | undefined;
          if (hasTools) {
            // Non-streaming path: parse the full response and synthesize
            // ChatChunks so the public streaming API is unchanged.
            const json: any = await resp.json();
            const choice = json?.choices?.[0] ?? {};
            const message = choice.message ?? {};
            assistantContent = message.content ?? "";
            const toolCalls: AssistantToolCall[] | undefined =
              Array.isArray(message.tool_calls) && message.tool_calls.length
                ? (message.tool_calls as AssistantToolCall[])
                : undefined;
            const meta: StreamMeta = {
              id: json?.id,
              model: json?.model,
              created: json?.created,
              usage: json?.usage,
              finish_reason: choice.finish_reason,
            };
            if (assistantContent) {
              yield { delta: assistantContent, meta, done: false };
            }
            yield {
              delta: "",
              meta,
              done: true,
              tool_calls: toolCalls,
            };
            if (toolCalls) pendingCalls = toolCalls;
          } else {
            for await (const chunk of parseSSEChunks(resp)) {
              if (!chunk.done) assistantContent += chunk.delta;
              if (chunk.done && chunk.tool_calls) pendingCalls = chunk.tool_calls;
              yield chunk;
            }
          }

          // No tools requested OR no registry → done.
          if (!pendingCalls || pendingCalls.length === 0 || !tools) {
            return;
          }
          if (iteration >= maxIterations) {
            // Safety net — emit a synthetic chunk so downstream sees
            // the loop bailed and don't silently leave the chat in a
            // weird "model wants more tools but we won't run them" state.
            yield {
              delta: `\n\n[tool-loop hit max_iterations=${maxIterations}; refusing to dispatch further calls]`,
              meta: {},
              done: true,
            };
            return;
          }

          // Append the assistant message that requested the tools.
          messages = [
            ...messages,
            {
              role: "assistant",
              content: assistantContent,
              tool_calls: pendingCalls,
            },
          ];

          // Dispatch each call sequentially. Any single failure is
          // surfaced as the tool's content (so the model can recover
          // by trying a different argument); only catastrophic errors
          // bubble.
          for (const call of pendingCalls) {
            let parsedArgs: unknown = null;
            try {
              parsedArgs = JSON.parse(call.function.arguments || "{}");
            } catch {
              parsedArgs = call.function.arguments;
            }
            const start = Date.now();
            let result: unknown;
            let errMsg: string | undefined;
            try {
              result = await tools.invoke(call.function.name, parsedArgs, {
                signal: req.signal,
                origin: { model: req.model },
              });
            } catch (err) {
              errMsg = err instanceof Error ? err.message : String(err);
              result = { error: errMsg };
            }
            const duration_ms = Date.now() - start;
            if (onToolCall) {
              try {
                onToolCall({
                  call,
                  args: parsedArgs,
                  result: errMsg ? undefined : result,
                  error: errMsg,
                  duration_ms,
                  iteration,
                });
              } catch {
                /* user callback errors don't break the loop */
              }
            }
            messages = [
              ...messages,
              {
                role: "tool",
                tool_call_id: call.id,
                name: call.function.name,
                content:
                  typeof result === "string" ? result : JSON.stringify(result),
              },
            ];
          }
          iteration += 1;
          // Loop back — issue a follow-up request with the appended
          // assistant + tool messages and stream the next leg.
        }
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
