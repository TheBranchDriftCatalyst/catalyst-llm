/**
 * Engine config store — per-Agent tunable overrides.
 *
 * Each Agent registered with catalyst-langgraph (see /api/agents)
 * advertises a config_schema. The Engine tab lets the operator edit
 * those values; this store persists the edits in localStorage and the
 * chat dispatch path reads them on every `streamAgent()` send,
 * passing them as `agent_config` in the request body. When a field
 * is unset (no override stored), the backend falls back to env vars
 * → built-in defaults.
 *
 * v1 = a single global config (per-user, per-device, per-browser).
 * v2 will layer per-chat overrides on top — each chat can opt to use
 * a custom engine config, and the store grows an `overridesByChatId`
 * dict. The default-resolution helper stays the same.
 *
 * Why a separate store (vs folding into chatStore): the engine config
 * is orthogonal to conversational state — multiple chats share the
 * same engine. Keeping it standalone matches usePromptStore /
 * useCompareStore conventions.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * `Record<agentId, partialConfig>`. The partialConfig only carries
 * keys the operator has explicitly overridden — missing keys fall back
 * to defaults. This keeps the persisted payload small and avoids
 * stale-default-pinning when we add new fields to a schema.
 */
export type EngineConfigs = Record<string, Record<string, unknown>>;

export interface EngineStore {
  configs: EngineConfigs;
  /** Replace a single field on an Agent's config. Pass `undefined` to
   * clear a previously-set override (so the backend default re-applies). */
  setField: (agentId: string, fieldName: string, value: unknown) => void;
  /** Replace the whole partial config for an Agent (used by "Reset to defaults"). */
  setAgentConfig: (agentId: string, config: Record<string, unknown>) => void;
  /** Clear every override for an Agent. */
  resetAgent: (agentId: string) => void;
  /** Compute the wire payload for `streamAgent`'s `agent_config` field.
   * Returns `undefined` when no overrides are set so the request stays
   * byte-identical to today's traffic for users who never touch the
   * Engine tab. */
  asRequestPayload: () => Record<string, Record<string, unknown>> | undefined;
}

export const useEngineStore = create<EngineStore>()(
  persist(
    (set, get) => ({
      configs: {},

      setField: (agentId, fieldName, value) =>
        set((state) => {
          const next = { ...state.configs };
          const agentCfg = { ...(next[agentId] ?? {}) };
          if (value === undefined) {
            delete agentCfg[fieldName];
          } else {
            agentCfg[fieldName] = value;
          }
          if (Object.keys(agentCfg).length === 0) {
            delete next[agentId];
          } else {
            next[agentId] = agentCfg;
          }
          return { configs: next };
        }),

      setAgentConfig: (agentId, config) =>
        set((state) => {
          const next = { ...state.configs };
          if (Object.keys(config).length === 0) {
            delete next[agentId];
          } else {
            next[agentId] = { ...config };
          }
          return { configs: next };
        }),

      resetAgent: (agentId) =>
        set((state) => {
          if (!(agentId in state.configs)) return state;
          const next = { ...state.configs };
          delete next[agentId];
          return { configs: next };
        }),

      asRequestPayload: () => {
        const { configs } = get();
        const keys = Object.keys(configs);
        if (keys.length === 0) return undefined;
        // Strip empty inner objects defensively — they'd be no-ops
        // server-side, but sending them adds noise to debugging.
        const out: Record<string, Record<string, unknown>> = {};
        for (const k of keys) {
          const c = configs[k];
          if (c && Object.keys(c).length > 0) out[k] = c;
        }
        return Object.keys(out).length > 0 ? out : undefined;
      },
    }),
    {
      name: "catalyst-llm-sdk:engine",
      storage: createJSONStorage(() => localStorage),
      // Only `configs` is meaningful state; the methods are recreated
      // on every mount.
      partialize: (s) => ({ configs: s.configs }),
    },
  ),
);
