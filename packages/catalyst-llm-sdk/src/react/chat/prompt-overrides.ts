import { usePromptStore } from "../promptStore.js";

/**
 * Walk an agent_config map and build a `prompt_overrides` payload
 * resolving every `system_prompt_ref` to the matching saved-prompt
 * content from the operator's PromptStore. Refs without a matching
 * preset (e.g. the preset was deleted client-side) are dropped — the
 * backend falls through to the node's inline `system_prompt` or
 * default in that case.
 *
 * Returns `undefined` when no refs are bound on any node, so the wire
 * payload stays compact for the common case.
 */
export function collectPromptOverrides(
  agentConfig:
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined,
): Record<string, string> | undefined {
  if (!agentConfig) return undefined;
  const refIds = new Set<string>();
  for (const nodeCfgs of Object.values(agentConfig)) {
    if (!nodeCfgs) continue;
    for (const fields of Object.values(nodeCfgs)) {
      if (!fields) continue;
      const ref = fields["system_prompt_ref"];
      if (typeof ref === "string" && ref.length > 0) refIds.add(ref);
    }
  }
  if (refIds.size === 0) return undefined;
  const presets = usePromptStore.getState().presets;
  const byId = new Map(presets.map((p) => [p.id, p]));
  const out: Record<string, string> = {};
  for (const id of refIds) {
    const p = byId.get(id);
    // Only include refs that resolve to a non-empty systemPrompt.
    // A preset with category "user" (no systemPrompt) would be a
    // misconfiguration; drop it silently and let the node fall back.
    if (p?.systemPrompt) out[id] = p.systemPrompt;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
