/**
 * Dev-only helpers. Anything in this module exists for local benchmarking
 * convenience and is intentionally **not** re-exported from the main SDK
 * barrel — that way, production apps that never import from
 * `@catalyst/llm-sdk/dev` won't pull this code into their bundle.
 *
 * Why dev-only: the unload trick relies on `keep_alive: 0` being honored by
 * the upstream backend (Ollama via LiteLLM). It's safe to send anywhere, but
 * it's a benchmarking concern, not an end-user concern, and we don't want
 * production chat surfaces to ship code that "evicts the model" by design.
 */
import type { CatalystLLMClient } from "../client/index.js";

/**
 * Best-effort hint that the backend should unload the model from memory.
 * Pairs with the comparison page's "sequential + unload between runs" mode
 * for fair head-to-head benchmarking on a single Ollama daemon.
 *
 * Sends a 1-token chat completion with `keep_alive: 0` so LiteLLM forwards
 * it to Ollama, which immediately evicts the model. Cloud providers ignore
 * the field. Errors are swallowed — this is purely a memory-pressure hint.
 */
export async function unloadModel(
  client: CatalystLLMClient,
  modelId: string,
): Promise<void> {
  try {
    const cfg = client.config;
    await cfg.fetchImpl(`${cfg.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.authHeader ?? {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "." }],
        stream: false,
        max_tokens: 1,
        keep_alive: 0,
      }),
    });
  } catch {
    // Intentional: unload is a hint, not a guarantee. Don't surface failures
    // to callers — a stuck unload shouldn't block the next comparison turn.
  }
}
