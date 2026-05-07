import type { Model } from "./types.js";

const EMBEDDING_RX = /(embed|embedding)/i;

export interface ModelCapabilities {
  reasoning: boolean;
  embedding: boolean;
}

/**
 * Best-effort model capability detection by ID pattern. The proxy is the
 * source of truth — these heuristics let UIs gate optional controls (e.g.
 * a "thinking" toggle) without a round-trip. False is the safe default;
 * worst case is a hidden toggle that would otherwise toggle harmlessly.
 *
 * Heuristic table updated: 2026-05.
 */
export function modelSupportsReasoning(
  modelId: string | undefined | null,
): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  // Strip backend prefixes like "litellm:" / "ollama:"
  const bare = id.includes(":") ? id.split(":").slice(1).join(":") : id;

  // OpenAI o-series + GPT-5 reasoning families
  if (bare.startsWith("o1") || bare.startsWith("o3") || bare.startsWith("o4"))
    return true;
  if (bare.startsWith("gpt-5-thinking") || bare.startsWith("gpt-5-pro"))
    return true;

  // Anthropic Claude 3.7+ extended thinking
  if (bare.startsWith("claude-3-7")) return true;
  if (
    bare.startsWith("claude-opus-4") ||
    bare.startsWith("claude-sonnet-4") ||
    bare.startsWith("claude-haiku-4")
  )
    return true;

  // DeepSeek r-series
  if (bare.includes("deepseek-r1") || bare.includes("deepseek-r2")) return true;

  // Qwen reasoning families
  if (bare.includes("qwq")) return true;
  if (bare.includes("qwen3") && bare.includes("thinking")) return true;

  // Reflective / agent-tuned community models
  if (bare.includes("reflect") || bare.includes("reasoner")) return true;

  return false;
}

export function isEmbeddingModel(modelId: string | undefined | null): boolean {
  return Boolean(modelId && EMBEDDING_RX.test(modelId));
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  return {
    reasoning: modelSupportsReasoning(modelId),
    embedding: isEmbeddingModel(modelId),
  };
}

/**
 * Group models by provider family (anthropic / openai / runpod / ollama / etc.)
 * for an `<optgroup>`-style render. Embedding-only models are filtered out so
 * users don't pick a dead end in chat UIs.
 */
export function groupModelsByFamily(
  models: Pick<Model, "id">[],
): { label: string; ids: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const m of models) {
    if (isEmbeddingModel(m.id)) continue;
    const family: string = m.id.startsWith("claude")
      ? "anthropic"
      : m.id.startsWith("gpt") || m.id.startsWith("o3")
        ? "openai"
        : m.id.startsWith("runpod")
          ? "runpod"
          : m.id.includes("/")
            ? (m.id.split("/")[0] ?? "ollama")
            : "ollama";
    if (!buckets.has(family)) buckets.set(family, []);
    buckets.get(family)!.push(m.id);
  }
  return [...buckets.entries()].map(([label, ids]) => ({
    label,
    ids: ids.sort(),
  }));
}
