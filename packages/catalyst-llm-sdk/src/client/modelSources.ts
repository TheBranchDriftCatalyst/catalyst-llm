/**
 * ModelSource — strategy pattern for the catalogue ``useModels()`` returns.
 *
 * The SDK historically fetched from LiteLLM's ``/v1/models`` +
 * ``/model/info``. Hosts now select the source at <LLMProvider> mount
 * time, so the same chat surface can run against:
 *   - LiteLLM proxy (default; ``LiteLLMModelSource``)
 *   - Local Ollama with no proxy (``OllamaModelSource``)
 *   - A static / hand-curated catalogue (``StaticModelSource``)
 *   - Any HTTP endpoint that returns ModelWithRouting JSON (``HttpModelSource``)
 *   - A custom user-implemented source (just implement the interface)
 *
 * Hosts pick the strategy in one line:
 *   <LLMProvider modelSource={new OllamaModelSource()}>
 *
 * Swapping back to LiteLLM later is one prop change. No host-side
 * fork of the SDK is needed.
 */
import type { CatalystLLMClient } from "./client.js";
import { getEndpointInfo } from "./endpoints.js";
import type { ModelWithRouting } from "./types.js";

export interface ModelSource {
  /** Short identifier for diagnostics + the "static — N models" label
   *  in the model selector. */
  readonly name: string;
  /** Fetch the current catalogue. Called once on mount and again on
   *  manual refresh. Should resolve to [] on transient errors so the
   *  UI can show "no models" rather than blocking on a spinner. */
  listModels(): Promise<ModelWithRouting[]>;
}

// ── LiteLLM (default — wraps the existing CatalystLLMClient) ──────────

export class LiteLLMModelSource implements ModelSource {
  readonly name = "litellm";
  constructor(private readonly client: CatalystLLMClient) {}
  listModels(): Promise<ModelWithRouting[]> {
    return this.client.getModelsWithRouting();
  }
}

// ── Static (hand-curated, no network) ─────────────────────────────────

export class StaticModelSource implements ModelSource {
  readonly name = "static";
  constructor(private readonly models: ModelWithRouting[]) {}
  listModels(): Promise<ModelWithRouting[]> {
    return Promise.resolve(this.models);
  }
}

// ── HTTP (host-provided endpoint, same-origin avoids CORS) ────────────

/**
 * Fetches from a JSON endpoint that returns either a bare
 * ``ModelWithRouting[]`` or ``{ data: ModelWithRouting[] }`` or
 * ``{ models: ModelWithRouting[] }``. Useful when the host operator
 * runs its own backend proxy (e.g. catalyst-operator at
 * ``/api/agent/models``) so the browser doesn't hit a remote proxy or
 * trip CORS on a non-localhost LLM endpoint.
 */
export class HttpModelSource implements ModelSource {
  readonly name: string;
  constructor(
    private readonly url: string,
    private readonly init: RequestInit = {},
  ) {
    this.name = `http:${url}`;
  }
  async listModels(): Promise<ModelWithRouting[]> {
    const resp = await fetch(this.url, this.init);
    if (!resp.ok) {
      throw new Error(
        `HttpModelSource(${this.url}): ${resp.status} ${resp.statusText}`,
      );
    }
    const json = await resp.json();
    if (Array.isArray(json)) return json as ModelWithRouting[];
    if (Array.isArray(json?.models)) return json.models as ModelWithRouting[];
    if (Array.isArray(json?.data)) return json.data as ModelWithRouting[];
    return [];
  }
}

// ── Ollama (native /api/tags, no LiteLLM proxy) ───────────────────────

interface OllamaTag {
  name: string;
  modified_at?: string;
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

/**
 * Fetches Ollama's native /api/tags and maps each entry to a
 * ModelWithRouting. The model id is the Ollama name (e.g.
 * ``qwen3:32b-q8_0``); endpoint is set to a synthetic "mac" routing
 * group so existing ModelSelector grouping (mac/cluster/cloud)
 * Just Works. Pricing is left undefined since local models have no
 * per-token cost — CostPins will render $0.00 which is correct.
 *
 * baseUrl defaults to ``http://localhost:11434``; pass a different
 * URL when Ollama is mounted under an operator proxy.
 */
export class OllamaModelSource implements ModelSource {
  readonly name = "ollama";
  constructor(
    private readonly baseUrl: string = "http://localhost:11434",
  ) {}
  async listModels(): Promise<ModelWithRouting[]> {
    const resp = await fetch(`${this.baseUrl}/api/tags`);
    if (!resp.ok) {
      throw new Error(
        `OllamaModelSource: ${resp.status} ${resp.statusText}`,
      );
    }
    const data = (await resp.json()) as { models?: OllamaTag[] };
    const tags = data.models ?? [];
    return tags.map((t) => ({
      id: t.name,
      object: "model" as const,
      created: t.modified_at ? Date.parse(t.modified_at) / 1000 : 0,
      owned_by: "ollama",
      endpoint: getEndpointInfo(this.baseUrl),
      underlyingModel: `ollama/${t.name}`,
      metadata: t.details
        ? {
            // Best-effort metadata mapping — Ollama doesn't expose
            // context limit or pricing; leave them undefined so the
            // UI renders gracefully (CostPins shows $0.00, context
            // meter hides).
            model_info: {
              parameter_size: t.details.parameter_size,
              quantization_level: t.details.quantization_level,
              family: t.details.family,
            },
          }
        : undefined,
    })) as ModelWithRouting[];
  }
}
