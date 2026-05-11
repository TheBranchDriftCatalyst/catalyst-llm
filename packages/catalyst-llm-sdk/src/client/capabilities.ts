import type { Model } from "./types.js";
import { inferModelHints, isEmbeddingModelHint } from "./modelHints.js";

export interface ModelCapabilities {
  reasoning: boolean;
  embedding: boolean;
}

/**
 * Best-effort model capability detection. Delegates to inferModelHints, which
 * checks the generated registry (packages/mac-node/models.yaml → JSON) first
 * and the hand-written regex rules in modelHints.ts as a fallback. The proxy
 * is still the source of truth for runtime calls — this is just a UI-side
 * shortcut for gating optional controls.
 *
 * Note: legacy callers that strip a backend prefix before passing the id
 * (e.g. "litellm:gpt-5-pro" → "gpt-5-pro") still work because the regex
 * fallback matches against the full string.
 */
export function modelSupportsReasoning(
  modelId: string | undefined | null,
): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  const bare = id.includes(":") ? id.split(":").slice(1).join(":") : id;
  return Boolean(inferModelHints(bare).supportsReasoning);
}

export function isEmbeddingModel(modelId: string | undefined | null): boolean {
  return isEmbeddingModelHint(modelId);
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
