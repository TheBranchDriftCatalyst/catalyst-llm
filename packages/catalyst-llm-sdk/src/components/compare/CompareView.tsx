import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Play,
  Square,
  Trash2,
  Timer,
  Zap,
  Coins,
  ArrowDown,
  ArrowUp,
  Activity,
  X,
  GitCompareArrows,
  Brain,
  Columns3,
  Table as TableIcon,
  BarChart3,
  ChevronRight,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import type { ChatParams, ModelWithRouting } from "../../client/index.js";
import { useModels } from "../../react/hooks.js";
import {
  useCompare,
  useCompareStore,
  type CompareMode,
  type CompareRun,
} from "../../react/useCompare.js";
import {
  formatUsd,
  formatTokens,
  formatMs,
  formatRate,
} from "../../react/useChatCost.js";
import { ModelMultiSelect } from "../model-selector/ModelMultiSelect.js";
import { ModelInfoCard } from "../model-selector/ModelInfoCard.js";
import { PromptPresets, SystemPromptPresets } from "../prompts/PromptPresets.js";
import { CompareGraphs } from "./CompareGraphs.js";
import { RenderedContent } from "../RenderedContent.js";
import { cn } from "../utils.js";
import { ResponseColumn } from "./compare-response-column.js";
import { ResultsTable } from "./compare-results-table.js";

const REASONING_LEVELS = ["low", "medium", "high"] as const;


export interface CompareViewProps {
  className?: string;
  /**
   * Optional dev hook called between sequential turns. Wire `unloadModel`
   * from `@catalyst/llm-sdk/dev` here when running local benchmarks so each
   * model gets a clean memory slot. Production builds simply omit it.
   */
  onTurnComplete?: (modelId: string) => Promise<void> | void;
}

/**
 * Multi-model side-by-side comparison page. Pick N models, send the same
 * prompt, watch each response stream in independently, and toggle a
 * line-diff against any chosen reference column.
 */
export function CompareView({ className, onTurnComplete }: CompareViewProps) {
  const { models } = useModels();
  // These three live in the store so navigating away from /compare doesn't
  // wipe the user's prompt + selection. Local UI-only state (sort, expand,
  // mode toggles) stays in component state — losing those on nav is fine.
  const selectedIds = useCompareStore((s) => s.selectedIds);
  const setSelectedIds = useCompareStore((s) => s.setSelectedIds);
  const systemPrompt = useCompareStore((s) => s.systemPrompt);
  const setSystemPrompt = useCompareStore((s) => s.setSystemPrompt);
  const prompt = useCompareStore((s) => s.prompt);
  const setPrompt = useCompareStore((s) => s.setPrompt);

  const [reasoningEffort, setReasoningEffort] =
    useState<NonNullable<ChatParams["reasoning_effort"]> | undefined>(undefined);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [viewMode, setViewMode] = useState<"columns" | "table" | "graphs">(
    "columns",
  );
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<
    "model" | "ttft" | "tokps" | "rt" | "cost" | "out"
  >("model");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [mode, setMode] = useState<CompareMode>("sequential");
  // Default ON when running locally — most users land here to benchmark mac/* models.
  const [unloadBetween, setUnloadBetween] = useState(true);

  const {
    runs,
    isAnyStreaming,
    hasInterrupted,
    runAll,
    resumeInterrupted,
    resumeRun,
    stopAll,
    clear,
  } = useCompare();
  const hasLocalSelected = selectedIds.some((id) =>
    models.find((m) => m.id === id)?.endpoint?.type === "mac",
  );

  // Auto-pick the first selected model as reference when nothing is set.
  useEffect(() => {
    if (referenceId && selectedIds.includes(referenceId)) return;
    if (selectedIds[0]) setReferenceId(selectedIds[0]);
  }, [selectedIds, referenceId]);

  const referenceText = referenceId ? runs[referenceId]?.text ?? "" : "";

  function removeModel(id: string) {
    setSelectedIds(selectedIds.filter((m) => m !== id));
    if (referenceId === id) {
      const next = selectedIds.find((m) => m !== id) ?? null;
      setReferenceId(next);
    }
  }

  function handleRun() {
    if (!prompt.trim() || selectedIds.length === 0) return;
    void runAll(selectedIds, prompt, {
      systemPrompt: systemPrompt || undefined,
      params: reasoningEffort ? { reasoning_effort: reasoningEffort } : undefined,
      mode,
      onTurnComplete:
        mode === "sequential" && unloadBetween ? onTurnComplete : undefined,
    });
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="space-y-3 border-b border-border bg-card/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Multi-model comparison</h2>
            <p className="text-xs text-muted-foreground">
              Fan one prompt to N models. Each stream resolves independently.
              Toggle diff mode to compare against any reference column.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Result view mode"
              className="inline-flex overflow-hidden rounded-md border border-border"
            >
              <button
                type="button"
                aria-pressed={viewMode === "columns"}
                onClick={() => setViewMode("columns")}
                title="Side-by-side response columns"
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "columns"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Columns3 className="h-3 w-3" aria-hidden="true" />
                Columns
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "table"}
                onClick={() => setViewMode("table")}
                title="Sortable metrics table"
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <TableIcon className="h-3 w-3" aria-hidden="true" />
                Table
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "graphs"}
                onClick={() => setViewMode("graphs")}
                title="Bar charts comparing TTFT, tokens/sec, duration, etc."
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "graphs"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <BarChart3 className="h-3 w-3" aria-hidden="true" />
                Graphs
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDiffMode((d) => !d)}
              disabled={selectedIds.length < 2 || viewMode !== "columns"}
              aria-pressed={diffMode}
              className={cn(diffMode && "border-primary text-primary")}
              title={
                viewMode !== "columns"
                  ? "Diff is only available in columns view"
                  : undefined
              }
            >
              <GitCompareArrows className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {diffMode ? "Diff: on" : "Diff: off"}
            </Button>
            <Button variant="outline" size="sm" onClick={clear} disabled={isAnyStreaming}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs">Models</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ModelMultiSelect
              value={selectedIds}
              onChange={setSelectedIds}
              placeholder="Pick models…"
            />
            {selectedIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              >
                {id}
                <button
                  type="button"
                  onClick={() => removeModel(id)}
                  aria-label={`Remove ${id} from selection`}
                  title={`Remove ${id} from selection`}
                  className="text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {selectedIds.length === 0 && (
              <span className="text-xs italic text-muted-foreground">
                add at least 2 models to compare
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">System prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={2}
              className="mt-1 resize-none font-mono text-xs"
            />
            <SystemPromptPresets
              className="mt-1.5"
              onApply={(p) => {
                if (p.systemPrompt) setSystemPrompt(p.systemPrompt);
              }}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">User prompt</Label>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Ask all selected models the same thing…"
              className="mt-1 resize-none text-xs"
            />
            <PromptPresets
              className="mt-1.5"
              onApply={(p) => {
                if (p.user) setPrompt(p.user);
                if (p.systemPrompt) setSystemPrompt(p.systemPrompt);
              }}
            />
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <Label className="text-xs flex items-center gap-1.5">
              <Brain className="h-3 w-3 text-primary" aria-hidden="true" />
              Reasoning effort (applies to all reasoning-capable models)
            </Label>
            <div
              role="group"
              aria-label="Reasoning effort"
              className="mt-1 grid grid-cols-4 gap-1"
            >
              {(["off", ...REASONING_LEVELS] as const).map((level) => {
                const isOff = level === "off";
                const active = isOff ? !reasoningEffort : reasoningEffort === level;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setReasoningEffort(isOff ? undefined : (level as never))
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3 text-[11px]">
              <div
                role="group"
                aria-label="Run dispatch mode"
                className="inline-flex overflow-hidden rounded-md border border-border"
              >
                {(["parallel", "sequential"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "px-2 py-1 font-medium uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      mode === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {mode === "sequential" && onTurnComplete && (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5",
                    !hasLocalSelected && "opacity-50",
                  )}
                  title="Send keep_alive=0 to evict the Ollama model after each turn (dev-only)"
                >
                  <input
                    type="checkbox"
                    checked={unloadBetween}
                    onChange={(e) => setUnloadBetween(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  unload ollama between
                  <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold uppercase text-primary">
                    dev
                  </span>
                </label>
              )}
            </div>
            {isAnyStreaming ? (
              <Button onClick={stopAll} variant="destructive" size="sm">
                <Square className="mr-1 h-3.5 w-3.5" />
                Stop all
              </Button>
            ) : (
              <Button
                onClick={handleRun}
                disabled={!prompt.trim() || selectedIds.length === 0}
                size="sm"
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                Run on {selectedIds.length} model{selectedIds.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {hasInterrupted && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center justify-between gap-3 border-b border-yellow-600/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-500"
        >
          <span>
            One or more runs were interrupted (likely by a refresh). The
            partial responses are preserved — click Resume to re-issue them
            sequentially against the persisted prompt.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              resumeInterrupted({
                params: reasoningEffort
                  ? { reasoning_effort: reasoningEffort }
                  : undefined,
                onTurnComplete:
                  unloadBetween && onTurnComplete ? onTurnComplete : undefined,
              })
            }
            disabled={isAnyStreaming}
            className="shrink-0"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Resume interrupted
          </Button>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {selectedIds.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-2 text-muted-foreground">
            <Plus className="h-8 w-8 opacity-50" />
            <p className="text-sm">Add models above to start a comparison.</p>
          </div>
        ) : viewMode === "columns" ? (
          <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto p-4">
            {selectedIds.map((id) => {
              const model = models.find((m) => m.id === id);
              const run = runs[id];
              return (
                <ResponseColumn
                  key={id}
                  modelId={id}
                  run={run}
                  model={model}
                  isReference={referenceId === id}
                  onRemove={() => removeModel(id)}
                  onSetReference={() => setReferenceId(id)}
                  onResume={() =>
                    resumeRun(id, {
                      params: reasoningEffort
                        ? { reasoning_effort: reasoningEffort }
                        : undefined,
                      onTurnComplete:
                        unloadBetween && onTurnComplete
                          ? onTurnComplete
                          : undefined,
                    })
                  }
                  diffAgainst={
                    diffMode && referenceId !== id ? referenceText : null
                  }
                />
              );
            })}
          </div>
        ) : viewMode === "table" ? (
          <ResultsTable
            modelIds={selectedIds}
            runs={runs}
            models={models}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={(col) => {
              if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
              else {
                setSortBy(col);
                setSortDir("asc");
              }
            }}
            onRemove={removeModel}
          />
        ) : (
          <CompareGraphs selectedIds={selectedIds} runs={runs} />
        )}
      </div>
    </div>
  );
}

