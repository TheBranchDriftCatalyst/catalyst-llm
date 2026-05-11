import type { ModelMetadata, ModelWithRouting } from "./types.js";
import generatedHints from "./generated/modelHints.json" with { type: "json" };

/**
 * Heuristics that fill in the gaps when LiteLLM's `/model/info` doesn't ship
 * full metadata — typical for local Ollama / vLLM-MLX models, where the
 * model database isn't seeded.
 *
 * Two-tier lookup:
 *   1. Generated table from packages/mac-node/models.yaml (every mac/* model).
 *      Adds entries are automatic — run `task models` to regen.
 *   2. Hand-written regex RULES below, used when the generated table has no
 *      key for this model (hosted providers, models not in the mac-node
 *      registry, ad-hoc community quants).
 *
 * The patterns are intentionally pessimistic: we'd rather hide a control on
 * a borderline model than show one that breaks. Order matters in RULES
 * (first match wins).
 */

interface GeneratedEntry {
  name: string;
  aliases: string[];
  tags: string[];
  category?: string | null;
  keys: string[];
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  isEmbedding: boolean;
}

// Index the generated table by every key (Ollama tag + every mac/* alias)
// so a single lookup serves both `mac/qwen3-coder` and the raw Ollama
// `qwen3-coder:30b-a3b-q8_0`.
const GENERATED_BY_KEY: Map<string, GeneratedEntry> = (() => {
  const map = new Map<string, GeneratedEntry>();
  for (const entry of (generatedHints as { models: GeneratedEntry[] }).models) {
    for (const key of entry.keys) map.set(key.toLowerCase(), entry);
  }
  return map;
})();

interface HintRule {
  /** Lowercased substring(s) — any match wins. Use the most specific token. */
  match: RegExp;
  /** Whether this model exposes a `reasoning_effort` / extended-thinking knob. */
  supportsReasoning?: boolean;
  /** Native context window in tokens. */
  maxInputTokens?: number;
  /** Whether the model accepts vision/image inputs. */
  supportsVision?: boolean;
  /** Whether the model is fine-tuned for tool / function calling. */
  supportsFunctionCalling?: boolean;
}

// Patterns are matched against the model id (e.g. "mac/deepseek-r1-7b") AND
// the underlying model string from LiteLLM (e.g. "ollama/deepseek-r1:7b").
const RULES: HintRule[] = [
  // ── Reasoning models ─────────────────────────────────────────────────
  // DeepSeek R1 family (open-weights reasoning)
  { match: /deepseek[-_]?r1/i, supportsReasoning: true, maxInputTokens: 65536 },
  // Qwen QwQ + Qwen3 reasoning variants
  { match: /\bqwq\b/i, supportsReasoning: true, maxInputTokens: 32768 },
  { match: /qwen3-?coder/i, supportsReasoning: true, maxInputTokens: 262144 },
  { match: /qwen3\.6/i, supportsReasoning: true, maxInputTokens: 262144 },
  { match: /qwen3-?(?:32b|30b)/i, supportsReasoning: true, maxInputTokens: 131072 },
  // Any Qwen3 variant with explicit "thinking" tag
  { match: /qwen3.*thinking/i, supportsReasoning: true, maxInputTokens: 131072 },
  // Reflective / agent-tuned community models (reflection-*, *-reasoner, etc.)
  { match: /\b(reflect(?:ion)?|reasoner)\b/i, supportsReasoning: true },
  // OpenAI o-series + gpt-5 (always reasoning)
  { match: /\bo[134](?:-mini)?\b/i, supportsReasoning: true, maxInputTokens: 200000 },
  { match: /gpt-5/i, supportsReasoning: true, maxInputTokens: 400000 },
  // Anthropic extended-thinking models (claude-3.7+ and claude-4+)
  { match: /claude-(?:3-7|4|opus-4|sonnet-4|haiku-4)/i, supportsReasoning: true, maxInputTokens: 200000 },
  // Gemini thinking
  { match: /gemini-2\.[05].*thinking/i, supportsReasoning: true, maxInputTokens: 1000000 },
  // Gemma 3 / 4 reasoning variants
  { match: /gemma-?[34]/i, supportsReasoning: true, maxInputTokens: 131072, supportsVision: true },

  // ── Non-reasoning, but well-known context windows ────────────────────
  { match: /llama-?3\.[12]/i, maxInputTokens: 131072 },
  { match: /llama-?3\.3/i, maxInputTokens: 131072 },
  { match: /qwen2\.5-?coder/i, maxInputTokens: 32768, supportsFunctionCalling: true },
  { match: /qwen2\.5/i, maxInputTokens: 32768 },
  { match: /devstral/i, maxInputTokens: 131072, supportsFunctionCalling: true },
  { match: /mistral-?nemo/i, maxInputTokens: 131072 },
  { match: /mistral-?(?:7b)?(?:-?instruct)?/i, maxInputTokens: 32768 },
  { match: /phi-?4/i, maxInputTokens: 16384 },
  { match: /dolphin-?(?:mistral|3)/i, maxInputTokens: 32768 },

  // ── Community RP / uncensored quants ────────────────────────────────
  // These ship via Ollama as freshly-`ollama create`d models from a
  // community GGUF + minimal Modelfile. The thinking/reasoning template
  // is NOT baked into those quants, so Ollama refuses `think: true`
  // requests with "<tag> does not support thinking" — even when the
  // upstream finetune name implies reasoning. Mark explicitly false
  // so the SDK strips reasoning_effort before sending.
  // (Order matters — these have to come BEFORE generic qwen3 rules.)
  { match: /qwen3-moe-uncensored/i, supportsReasoning: false, maxInputTokens: 262144 },
  { match: /behemoth-?x/i, supportsReasoning: false, maxInputTokens: 32768 },
  { match: /magnum-?v\d/i, supportsReasoning: false, maxInputTokens: 16384 },
  { match: /cydonia/i, supportsReasoning: false, maxInputTokens: 32768 },
  { match: /hermes-?[34]/i, supportsReasoning: false, maxInputTokens: 131072 },
  { match: /wizardlm-?uncensored/i, supportsReasoning: false, maxInputTokens: 4096 },

  // ── Specialty extraction / NER ──────────────────────────────────────
  // NuExtract uses a tight context — its template-based extraction expects
  // short inputs and isn't really meant for long-context use.
  { match: /nuextract/i, supportsReasoning: false, maxInputTokens: 8192 },
  { match: /universalner/i, supportsReasoning: false, maxInputTokens: 4096 },

  // ── Embedding models — no chat context window meaningful ────────────
  { match: /embed/i, maxInputTokens: 8192 },
];

/**
 * Look up heuristic hints for a model.
 *
 *   1. Generated registry first — checks both `modelId` and `underlyingModel`
 *      against the keys produced from models.yaml by gen-sdk-hints.py.
 *   2. Regex RULES below as a fallback.
 *
 * Returns an empty object if neither tier matches — callers should still
 * prefer real `metadata` over hints.
 */
export function inferModelHints(
  modelId: string,
  underlyingModel?: string,
): HintRule {
  // Tier 1: generated registry — exact key lookup on either id.
  const id1 = modelId?.toLowerCase();
  const id2 = underlyingModel?.toLowerCase();
  const hit =
    (id1 && GENERATED_BY_KEY.get(id1)) ||
    (id2 && GENERATED_BY_KEY.get(id2));
  if (hit) {
    return {
      match: /(?:)/,
      supportsReasoning: hit.supportsReasoning,
      supportsVision: hit.supportsVision,
      supportsFunctionCalling: hit.supportsFunctionCalling,
      // maxInputTokens left undefined — LiteLLM's probed context_length
      // (in /model/info) is more accurate than anything we'd hardcode.
    };
  }

  // Tier 2: regex fallback for hosted / non-mac-node models.
  const haystack = `${modelId} ${underlyingModel ?? ""}`;
  for (const rule of RULES) {
    if (rule.match.test(haystack)) return rule;
  }
  return { match: /(?:)/ };
}

/**
 * Quick check: is this an embedding model? Uses the generated registry
 * first, then falls back to the embed/embedding regex.
 */
export function isEmbeddingModelHint(
  modelId: string | undefined | null,
): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  const hit = GENERATED_BY_KEY.get(id);
  if (hit) return hit.isEmbedding;
  return /(embed|embedding)/i.test(modelId);
}

/**
 * Returns the effective metadata for a model, layering inferred hints under
 * any real fields LiteLLM provided. Use this anywhere you'd previously read
 * `model.metadata?.<field>` directly to get a graceful fallback for local
 * models without server-side metadata.
 */
export function effectiveMetadata(
  model: ModelWithRouting | undefined,
): ModelMetadata {
  if (!model) return {};
  const meta = model.metadata ?? {};
  const hints = inferModelHints(model.id, model.underlyingModel);
  return {
    ...meta,
    max_input_tokens: meta.max_input_tokens ?? hints.maxInputTokens,
    max_tokens: meta.max_tokens ?? hints.maxInputTokens,
    supports_reasoning:
      meta.supports_reasoning ?? hints.supportsReasoning ?? null,
    supports_vision: meta.supports_vision ?? hints.supportsVision ?? null,
    supports_function_calling:
      meta.supports_function_calling ?? hints.supportsFunctionCalling ?? null,
  };
}
