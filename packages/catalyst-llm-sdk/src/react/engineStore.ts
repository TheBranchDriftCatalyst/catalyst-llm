/**
 * Engine config store — per-node tunable overrides.
 *
 * Each LangGraph node registered with catalyst-langgraph (see
 * /api/agents → topology.nodes[]) optionally advertises a
 * `config_schema`. The Engine tab lets the operator edit those values
 * per-node; this store persists the edits in localStorage and the chat
 * dispatch path reads them on every `streamAgent()` send, passing them
 * as `agent_config` in the request body.
 *
 * Shape: `{ [agentId]: { [nodeId]: { [field]: value, ... }, ... }, ... }`.
 * Only fields the operator explicitly overrode are stored — missing
 * keys fall back to defaults server-side. Empty inner dicts are
 * pruned on every mutation so the persisted payload stays small.
 *
 * v2 — re-keyed by node to match the per-node Pydantic config layout
 * the backend now ships. v1 (flat per-Agent) data is dropped on
 * rehydrate; per the project's roll-forward convention, no migration
 * shim. Operators who had edits in v1 get the defaults back and
 * re-set what they care about in the new per-node form.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * `Record<agentId, Record<nodeId, partialConfig>>`. The innermost
 * partialConfig only carries keys the operator has explicitly
 * overridden — missing keys fall back to defaults. Avoids
 * stale-default-pinning when we add new fields to a schema.
 */
export type NodeOverrides = Record<string, unknown>;
export type AgentNodeOverrides = Record<string, NodeOverrides>;
export type EngineConfigs = Record<string, AgentNodeOverrides>;

export interface EngineStore {
  configs: EngineConfigs;
  /** Replace a single field on one node of one Agent. Pass `undefined`
   * to clear a previously-set override (so the backend default re-applies). */
  setField: (
    agentId: string,
    nodeId: string,
    fieldName: string,
    value: unknown,
  ) => void;
  /** Replace the whole partial config for one node. Used by "Reset to
   * defaults" on a single node, and by bulk-set flows. */
  setNodeConfig: (
    agentId: string,
    nodeId: string,
    config: NodeOverrides,
  ) => void;
  /** Clear every override for an Agent (all nodes). */
  resetAgent: (agentId: string) => void;
  /** Clear every override for one node of an Agent. */
  resetNode: (agentId: string, nodeId: string) => void;
  /** Compute the wire payload for `streamAgent`'s `agent_config` field.
   * Returns `undefined` when no overrides are set, so the request
   * stays byte-identical to today's traffic for users who never touch
   * the Engine tab. */
  asRequestPayload: () =>
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;
}

function pruneEmptyNode(
  agentCfg: AgentNodeOverrides,
  nodeId: string,
  nodeCfg: NodeOverrides,
): AgentNodeOverrides {
  const next = { ...agentCfg };
  if (Object.keys(nodeCfg).length === 0) {
    delete next[nodeId];
  } else {
    next[nodeId] = nodeCfg;
  }
  return next;
}

function pruneEmptyAgent(
  configs: EngineConfigs,
  agentId: string,
  agentCfg: AgentNodeOverrides,
): EngineConfigs {
  const next = { ...configs };
  if (Object.keys(agentCfg).length === 0) {
    delete next[agentId];
  } else {
    next[agentId] = agentCfg;
  }
  return next;
}

export const useEngineStore = create<EngineStore>()(
  persist(
    (set, get) => ({
      configs: {},

      setField: (agentId, nodeId, fieldName, value) =>
        set((state) => {
          const agentCfg = { ...(state.configs[agentId] ?? {}) };
          const nodeCfg = { ...(agentCfg[nodeId] ?? {}) };
          if (value === undefined) {
            delete nodeCfg[fieldName];
          } else {
            nodeCfg[fieldName] = value;
          }
          const nextAgent = pruneEmptyNode(agentCfg, nodeId, nodeCfg);
          return { configs: pruneEmptyAgent(state.configs, agentId, nextAgent) };
        }),

      setNodeConfig: (agentId, nodeId, config) =>
        set((state) => {
          const agentCfg = { ...(state.configs[agentId] ?? {}) };
          const nextAgent = pruneEmptyNode(agentCfg, nodeId, { ...config });
          return { configs: pruneEmptyAgent(state.configs, agentId, nextAgent) };
        }),

      resetAgent: (agentId) =>
        set((state) => {
          if (!(agentId in state.configs)) return state;
          const next = { ...state.configs };
          delete next[agentId];
          return { configs: next };
        }),

      resetNode: (agentId, nodeId) =>
        set((state) => {
          const agentCfg = state.configs[agentId];
          if (!agentCfg || !(nodeId in agentCfg)) return state;
          const nextAgent = { ...agentCfg };
          delete nextAgent[nodeId];
          return {
            configs: pruneEmptyAgent(state.configs, agentId, nextAgent),
          };
        }),

      asRequestPayload: () => {
        const { configs } = get();
        const agentKeys = Object.keys(configs);
        if (agentKeys.length === 0) return undefined;
        // Re-prune defensively — if anything ever wrote an empty inner
        // dict it'd be a server-side no-op, but trimming keeps the
        // debug logs honest.
        const out: Record<string, Record<string, Record<string, unknown>>> = {};
        for (const aid of agentKeys) {
          const inner = configs[aid];
          if (!inner) continue;
          const cleaned: Record<string, Record<string, unknown>> = {};
          for (const nid of Object.keys(inner)) {
            const node = inner[nid];
            if (node && Object.keys(node).length > 0) cleaned[nid] = node;
          }
          if (Object.keys(cleaned).length > 0) out[aid] = cleaned;
        }
        return Object.keys(out).length > 0 ? out : undefined;
      },
    }),
    {
      // v2 = per-node nested shape. The v1 key (without the suffix)
      // is intentionally left in localStorage; if an operator rolls
      // back the bundle, their old edits are still there. Forward
      // rollout reads only this v2 key, so v1 data is effectively
      // dropped without a migration shim.
      name: "catalyst-llm-sdk:engine:v2",
      storage: createJSONStorage(() => localStorage),
      // Only `configs` is meaningful state; the methods are recreated
      // on every mount.
      partialize: (s) => ({ configs: s.configs }),
    },
  ),
);
