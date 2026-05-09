import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { PromptPreset } from "../components/PromptPresets.js";

/**
 * A user-saved prompt. Extends the base {@link PromptPreset} shape that
 * the dropdown components understand, plus identity + categorization
 * fields the registry / editor needs.
 *
 * `category` decides which slot a preset fills:
 *  - `"user"`   — pre-fills the chat's user-prompt textarea
 *  - `"system"` — sets the chat's system prompt
 *  - `"both"`   — applies systemPrompt AND user fields together
 *
 * `modelPattern` is an optional case-insensitive regex matched against
 * the model id. When set, the preset only appears in the dropdown for
 * models whose id matches — mirrors the built-in `getPresetsForModel`
 * behavior so users can ship per-model templates without forking the
 * SDK.
 */
export interface CustomPreset extends PromptPreset {
  id: string;
  category: "user" | "system" | "both";
  modelPattern?: string;
  /** Free-form tag list for grouping in the editor sidebar. */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PromptStore {
  presets: CustomPreset[];

  /** Add a new preset, returns its id. */
  addPreset: (
    p: Omit<CustomPreset, "id" | "createdAt" | "updatedAt">,
  ) => string;
  /** Patch an existing preset; bumps updatedAt. No-op if id missing. */
  updatePreset: (id: string, patch: Partial<Omit<CustomPreset, "id">>) => void;
  /** Remove a preset by id. */
  removePreset: (id: string) => void;
  /** Clone a preset, returns the new id. */
  duplicatePreset: (id: string) => string | null;

  /** Filter helper for the dropdowns — returns presets matching the
   * requested category that also pass the optional modelId regex check. */
  presetsFor: (
    category: "user" | "system",
    modelId?: string,
  ) => CustomPreset[];

  // ── Backup / restore ────────────────────────────────────────────────
  /** Serialize the registry to a JSON string suitable for download. */
  exportJson: () => string;
  /** Replace the registry with the parsed contents of a JSON string. */
  importJson: (json: string, mode?: "replace" | "merge") => number;
}

export const usePromptStore = create<PromptStore>()(
  persist(
    (set, get) => ({
      presets: [],

      addPreset: (p) => {
        const id = nanoid(10);
        const now = Date.now();
        set((s) => ({
          presets: [...s.presets, { ...p, id, createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      updatePreset: (id, patch) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, ...patch, id, updatedAt: Date.now() } : p,
          ),
        })),

      removePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      duplicatePreset: (id) => {
        const src = get().presets.find((p) => p.id === id);
        if (!src) return null;
        const newId = nanoid(10);
        const now = Date.now();
        set((s) => ({
          presets: [
            ...s.presets,
            {
              ...src,
              id: newId,
              name: `${src.name} (copy)`,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        return newId;
      },

      presetsFor: (category, modelId) => {
        const all = get().presets;
        return all.filter((p) => {
          // Match either the requested category or the universal "both"
          // category — a "both" preset fills the system *and* user slot
          // simultaneously, so it shows up in either dropdown.
          if (p.category !== category && p.category !== "both") return false;
          if (!p.modelPattern) return true;
          if (!modelId) return true;
          try {
            return new RegExp(p.modelPattern, "i").test(modelId);
          } catch {
            // Bad regex on the user's part — show the preset anyway so
            // they can find it and fix the pattern in the editor.
            return true;
          }
        });
      },

      exportJson: () => {
        return JSON.stringify(
          { version: 1, exportedAt: Date.now(), presets: get().presets },
          null,
          2,
        );
      },

      importJson: (json, mode = "merge") => {
        const parsed = JSON.parse(json) as { presets?: CustomPreset[] };
        const incoming = Array.isArray(parsed.presets) ? parsed.presets : [];
        if (mode === "replace") {
          set({ presets: incoming });
          return incoming.length;
        }
        // Merge: import any preset whose id isn't already present;
        // existing ids win so we don't clobber user edits silently.
        const existingIds = new Set(get().presets.map((p) => p.id));
        const additions = incoming.filter((p) => !existingIds.has(p.id));
        set((s) => ({ presets: [...s.presets, ...additions] }));
        return additions.length;
      },
    }),
    {
      name: "catalyst-llm-sdk:prompts",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as any),
      ),
      version: 1,
    },
  ),
);
