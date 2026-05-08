import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  CatalystLLMClient,
  ChatParams,
  Message,
  StreamMeta,
} from "../client/index.js";
import { useLLMContext } from "./LLMProvider.js";

export interface CompareRun {
  modelId: string;
  text: string;
  meta?: StreamMeta;
  isStreaming: boolean;
  error?: string;
  /** Wall-clock dispatch time. */
  streamStartTime?: number;
  /** First chunk arrival time — TTFT base. */
  firstTokenTime?: number;
  /** Stream completion time — used for tok/s. */
  streamEndTime?: number;
  /**
   * Set when the run was killed by a page refresh / unmount before it could
   * finish. The text holds whatever streamed in pre-kill; `resumeRun(id)`
   * will discard it and re-issue the run.
   */
  interrupted?: boolean;
}

export type CompareMode = "parallel" | "sequential";

export interface CompareRunOptions {
  systemPrompt?: string;
  params?: ChatParams;
  /**
   * `parallel` (default): fan out all models at once — fastest wall-clock,
   * but local backends (Ollama/vLLM) compete for the same GPU/RAM slot and
   * benchmarks become unreliable.
   *
   * `sequential`: run one model at a time. Slower overall but each model
   * gets the full machine. Pair with `unloadBetween: true` to free Ollama
   * weights after each run so memory pressure is comparable.
   */
  mode?: CompareMode;
  /**
   * Optional async callback fired after each model's run completes. Use this
   * to inject dev-only behavior (e.g. import `unloadModel` from
   * `@catalyst/llm-sdk/dev` and pass it here) without making the SDK
   * statically depend on benchmarking utilities. The default is a no-op so
   * production bundles ship zero unload code.
   *
   * Only awaited in `mode: "sequential"` — parallel runs ignore it.
   */
  onTurnComplete?: (modelId: string) => Promise<void> | void;
  /**
   * When true, runs not in `modelIds` are kept as-is (used by
   * `resumeInterrupted` to only re-issue the dead ones). Default false —
   * a fresh run replaces the whole batch.
   */
  keepExisting?: boolean;
}

interface CompareStore {
  runs: Record<string, CompareRun>;
  /** Persisted between page navigations so the user's selection survives. */
  selectedIds: string[];
  /** Same — persisted across nav. */
  prompt: string;
  systemPrompt: string;

  // Internal: AbortControllers live in the store so navigating away from the
  // CompareView doesn't orphan in-flight streams. They're kept on a non-
  // reactive ref-style object (still inside the store, just not reactive).
  _ctrls: Map<string, AbortController>;

  setSelectedIds: (ids: string[]) => void;
  setPrompt: (s: string) => void;
  setSystemPrompt: (s: string) => void;

  isAnyStreaming: () => boolean;
  runAll: (
    client: CatalystLLMClient,
    modelIds: string[],
    prompt: string,
    init?: CompareRunOptions,
  ) => Promise<void>;
  /**
   * Re-issue every interrupted run with the persisted prompt + system prompt.
   * Runs sequentially so we don't dogpile a local backend after a refresh.
   */
  resumeInterrupted: (
    client: CatalystLLMClient,
    init?: Omit<CompareRunOptions, "mode">,
  ) => Promise<void>;
  stopAll: () => void;
  clear: () => void;
}

/**
 * Hoisted multi-model comparison state. Lives outside React's component tree
 * so:
 *
 * - Navigating between Chat/Compare tabs doesn't unmount-and-lose the runs.
 * - In-flight streams continue writing to the store even when CompareView is
 *   unmounted; coming back to the tab shows the up-to-the-moment state.
 * - AbortControllers live in the store, so `stopAll()` works after unmount
 *   and we never leak orphaned fetches.
 */
export const useCompareStore = create<CompareStore>()(
  persist(
    (set, get) => ({
      runs: {},
      selectedIds: [],
      prompt: "",
      systemPrompt: "You are a helpful assistant.",
      _ctrls: new Map(),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  setPrompt: (s) => set({ prompt: s }),
  setSystemPrompt: (s) => set({ systemPrompt: s }),

  isAnyStreaming: () =>
    Object.values(get().runs).some((r) => r.isStreaming),

  stopAll: () => {
    const ctrls = get()._ctrls;
    for (const c of ctrls.values()) c.abort();
    ctrls.clear();
  },

  clear: () => {
    get().stopAll();
    set({ runs: {} });
  },

  runAll: async (client, modelIds, prompt, init) => {
    // Cancel any in-flight before starting a new batch.
    get().stopAll();

    const messages: Message[] = [];
    if (init?.systemPrompt) {
      messages.push({ role: "system", content: init.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const mode: CompareMode = init?.mode ?? "parallel";
    const onTurnComplete = init?.onTurnComplete;

    // Seed slots so the UI shows columns immediately. When resuming we keep
    // already-completed runs and only re-seed the ones being re-issued.
    set((s) => {
      const base = init?.keepExisting ? { ...s.runs } : {};
      for (const id of modelIds) {
        base[id] = {
          modelId: id,
          text: "",
          isStreaming: mode === "parallel",
        };
      }
      return { runs: base };
    });

    const runOne = async (modelId: string) => {
      const ctrl = new AbortController();
      get()._ctrls.set(modelId, ctrl);
      patchRun(set, modelId, {
        isStreaming: true,
        streamStartTime: Date.now(),
        firstTokenTime: undefined,
        streamEndTime: undefined,
        meta: undefined,
        error: undefined,
      });
      try {
        const stream = client.streamChat({
          model: modelId,
          messages,
          params: init?.params,
          signal: ctrl.signal,
        });
        let firstTokenSeen = false;
        for await (const chunk of stream) {
          if (chunk.done) {
            patchRun(set, modelId, {
              isStreaming: false,
              meta: chunk.meta,
              streamEndTime: Date.now(),
            });
            break;
          }
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            patchRun(set, modelId, { firstTokenTime: Date.now() });
          }
          appendText(set, modelId, chunk.delta, chunk.meta);
        }
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          patchRun(set, modelId, {
            isStreaming: false,
            streamEndTime: Date.now(),
          });
        } else {
          patchRun(set, modelId, {
            isStreaming: false,
            error: err.message,
            streamEndTime: Date.now(),
          });
        }
      } finally {
        get()._ctrls.delete(modelId);
      }
    };

    if (mode === "parallel") {
      await Promise.allSettled(modelIds.map(runOne));
    } else {
      for (const id of modelIds) {
        await runOne(id);
        if (onTurnComplete) {
          try {
            await onTurnComplete(id);
          } catch {
            // onTurnComplete is best-effort (typically dev-only unload).
          }
        }
      }
    }
  },

  resumeInterrupted: async (client, init) => {
    const state = get();
    const ids = Object.values(state.runs)
      .filter((r) => r.interrupted)
      .map((r) => r.modelId);
    if (ids.length === 0 || !state.prompt.trim()) return;
    // Sequential — refreshing during a parallel local run usually means we
    // want to be gentle on restart, not dogpile the backend again.
    await state.runAll(client, ids, state.prompt, {
      ...init,
      mode: "sequential",
      keepExisting: true,
      systemPrompt: init?.systemPrompt ?? state.systemPrompt,
    });
  },
    }),
    {
      name: "catalyst-llm-sdk:compare",
      storage: createJSONStorage(() => localStorage),
      // Persist user-meaningful state. AbortControllers can't serialize, and
      // streaming state from a previous tab is meaningless after a refresh
      // (the underlying fetch is dead). We rehydrate the *content* and reset
      // any flags that imply live activity.
      partialize: (s) => ({
        runs: s.runs,
        selectedIds: s.selectedIds,
        prompt: s.prompt,
        systemPrompt: s.systemPrompt,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CompareStore>;
        const cleanedRuns: Record<string, CompareRun> = {};
        for (const [id, run] of Object.entries(p.runs ?? {})) {
          // Any run marked "streaming" pre-refresh had its fetch die with
          // the page. Flip it to interrupted so the UI can offer Resume.
          cleanedRuns[id] = run.isStreaming
            ? { ...run, isStreaming: false, interrupted: true }
            : run;
        }
        return {
          ...current,
          ...p,
          runs: cleanedRuns,
          _ctrls: new Map(),
        };
      },
    },
  ),
);

function patchRun(
  set: (fn: (s: CompareStore) => Partial<CompareStore>) => void,
  modelId: string,
  patch: Partial<CompareRun>,
) {
  set((s) => ({
    runs: {
      ...s.runs,
      [modelId]: {
        ...(s.runs[modelId] ?? { modelId, text: "", isStreaming: false }),
        ...patch,
      },
    },
  }));
}

function appendText(
  set: (fn: (s: CompareStore) => Partial<CompareStore>) => void,
  modelId: string,
  delta: string,
  meta: StreamMeta | undefined,
) {
  set((s) => {
    const cur = s.runs[modelId];
    if (!cur) return {};
    return {
      runs: {
        ...s.runs,
        [modelId]: {
          ...cur,
          text: cur.text + delta,
          meta: meta ?? cur.meta,
        },
      },
    };
  });
}

export interface UseCompareResult {
  runs: Record<string, CompareRun>;
  isAnyStreaming: boolean;
  /** True when at least one run was killed by a refresh and is waiting for resume. */
  hasInterrupted: boolean;
  runAll: (
    modelIds: string[],
    prompt: string,
    init?: CompareRunOptions,
  ) => Promise<void>;
  /** Re-issue every interrupted run with the persisted prompt + system prompt. */
  resumeInterrupted: (init?: Omit<CompareRunOptions, "mode">) => Promise<void>;
  /** Re-issue a single interrupted run by model ID. */
  resumeRun: (
    modelId: string,
    init?: Omit<CompareRunOptions, "mode">,
  ) => Promise<void>;
  stopAll: () => void;
  clear: () => void;
}

/**
 * React-side adapter over {@link useCompareStore}. Keeps the consumer API
 * identical to the previous local-state version (run/stop/clear) but the
 * underlying state is hoisted so navigation between Chat/Compare doesn't
 * cancel or lose anything in flight.
 */
export function useCompare(): UseCompareResult {
  const { client } = useLLMContext();
  const runs = useCompareStore((s) => s.runs);
  const isAnyStreaming = useCompareStore((s) =>
    Object.values(s.runs).some((r) => r.isStreaming),
  );
  const hasInterrupted = useCompareStore((s) =>
    Object.values(s.runs).some((r) => r.interrupted),
  );
  const runAllImpl = useCompareStore((s) => s.runAll);
  const resumeImpl = useCompareStore((s) => s.resumeInterrupted);
  const stopAll = useCompareStore((s) => s.stopAll);
  const clear = useCompareStore((s) => s.clear);

  return {
    runs,
    isAnyStreaming,
    hasInterrupted,
    runAll: (modelIds, prompt, init) =>
      runAllImpl(client as CatalystLLMClient, modelIds, prompt, init),
    resumeInterrupted: (init) =>
      resumeImpl(client as CatalystLLMClient, init),
    resumeRun: async (modelId, init) => {
      const s = useCompareStore.getState();
      const run = s.runs[modelId];
      if (!run?.interrupted || !s.prompt.trim()) return;
      await s.runAll(client as CatalystLLMClient, [modelId], s.prompt, {
        ...init,
        mode: "sequential",
        keepExisting: true,
        systemPrompt: init?.systemPrompt ?? s.systemPrompt,
      });
    },
    stopAll,
    clear,
  };
}
