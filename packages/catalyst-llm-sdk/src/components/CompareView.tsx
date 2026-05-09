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
  Braces,
  CircleAlert,
  RotateCcw,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import type { ChatParams, ModelWithRouting } from "../client/index.js";
import { useModels } from "../react/hooks.js";
import {
  useCompare,
  useCompareStore,
  type CompareMode,
  type CompareRun,
} from "../react/useCompare.js";
import {
  formatUsd,
  formatTokens,
  formatMs,
  formatRate,
} from "../react/useChatCost.js";
import { ModelMultiSelect } from "./ModelMultiSelect.js";
import { ModelInfoCard } from "./ModelInfoCard.js";
import { PromptPresets, SystemPromptPresets } from "./PromptPresets.js";
import { lineDiff } from "./diff.js";
import { CompareGraphs } from "./CompareGraphs.js";
import { RenderedContent } from "./RenderedContent.js";
import { cn } from "./utils.js";

const REASONING_LEVELS = ["low", "medium", "high"] as const;

interface PerRunStats {
  cost: number;
  ttftMs: number | null;
  tokensPerSec: number | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
}

interface JsonCheck {
  /** `null` when the text is empty or still streaming. */
  ok: boolean | null;
  /** Whether the JSON came from raw text or stripped fences. */
  source?: "raw" | "fenced";
  /** Parse error message if not ok. */
  error?: string;
}

/**
 * Attempt to parse the response text as JSON. Tries raw first; on failure,
 * looks for the first ```json … ``` (or unlabeled) fenced block and tries
 * that. We do this for parity with how models commonly wrap structured
 * output even when asked not to — the badge then honestly reports whether
 * the model held the format contract (raw) vs. cheated with fences.
 */
function checkJson(text: string, isStreaming: boolean): JsonCheck {
  const trimmed = text.trim();
  if (!trimmed || isStreaming) return { ok: null };
  try {
    JSON.parse(trimmed);
    return { ok: true, source: "raw" };
  } catch (rawErr) {
    // Look for fenced block: ```json\n...\n``` or ```\n...\n```
    const fenceMatch = trimmed.match(
      /```(?:json)?\s*\n?([\s\S]*?)\n?```/i,
    );
    if (fenceMatch) {
      try {
        JSON.parse(fenceMatch[1].trim());
        return { ok: true, source: "fenced" };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: (rawErr as Error).message };
  }
}

function JsonBadge({ check }: { check: JsonCheck }) {
  if (check.ok === null) return null;
  if (check.ok) {
    return (
      <span
        title={
          check.source === "raw"
            ? "Response is valid JSON (parsed raw)"
            : "Response is valid JSON, but wrapped in a markdown fence"
        }
        className={cn(
          "inline-flex items-center gap-0.5 rounded-sm border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          check.source === "raw"
            ? "border-primary/50 bg-primary/15 text-primary"
            : "border-yellow-600/50 bg-yellow-500/15 text-yellow-500",
        )}
      >
        <Braces className="h-2.5 w-2.5" />
        {check.source === "raw" ? "json" : "json (fenced)"}
      </span>
    );
  }
  return (
    <span
      title={check.error ? `Invalid JSON: ${check.error}` : "Invalid JSON"}
      className="inline-flex items-center gap-0.5 rounded-sm border border-destructive/50 bg-destructive/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-destructive"
    >
      <CircleAlert className="h-2.5 w-2.5" />
      not json
    </span>
  );
}

function statsForRun(
  run: CompareRun,
  model: ModelWithRouting | undefined,
): PerRunStats {
  const inTok = run.meta?.usage?.prompt_tokens ?? 0;
  const outTok = run.meta?.usage?.completion_tokens ?? 0;
  const inCost = model?.metadata?.input_cost_per_token ?? 0;
  const outCost = model?.metadata?.output_cost_per_token ?? 0;
  const ttftMs =
    run.firstTokenTime && run.streamStartTime
      ? run.firstTokenTime - run.streamStartTime
      : null;
  const genMs =
    run.firstTokenTime && run.streamEndTime
      ? run.streamEndTime - run.firstTokenTime
      : null;
  const tokensPerSec =
    genMs && genMs > 0 && outTok > 0 ? (outTok / genMs) * 1000 : null;
  const latencyMs =
    run.streamStartTime && run.streamEndTime
      ? run.streamEndTime - run.streamStartTime
      : null;
  return {
    cost: inCost * inTok + outCost * outTok,
    ttftMs,
    tokensPerSec,
    latencyMs,
    inputTokens: inTok,
    outputTokens: outTok,
  };
}

interface MiniPin {
  icon: React.ElementType;
  label: string;
  value: string;
  emphasis?: "default" | "primary" | "muted";
}

function MiniPinRow({ pins }: { pins: MiniPin[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {pins.map(({ icon: Icon, label, value, emphasis = "default" }) => (
        <span
          key={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono tabular-nums",
            emphasis === "primary"
              ? "border-primary/50 bg-primary/10 text-primary"
              : emphasis === "muted"
                ? "border-border/40 bg-muted/30 text-muted-foreground"
                : "border-border/60 bg-card/40",
          )}
        >
          <Icon className="h-2.5 w-2.5" />
          <span className="opacity-70 uppercase tracking-wider">{label}</span>
          <span className="font-semibold">{value}</span>
        </span>
      ))}
    </div>
  );
}

function ResponseColumn({
  modelId,
  run,
  model,
  isReference,
  onRemove,
  onSetReference,
  onResume,
  diffAgainst,
}: {
  modelId: string;
  run: CompareRun | undefined;
  model: ModelWithRouting | undefined;
  isReference: boolean;
  onRemove: () => void;
  onSetReference: () => void;
  onResume: () => void;
  diffAgainst: string | null;
}) {
  const stats = run ? statsForRun(run, model) : null;
  const showDiff = diffAgainst !== null && !isReference && run?.text;
  const jsonCheck = checkJson(run?.text ?? "", run?.isStreaming ?? false);

  const pins: MiniPin[] = stats
    ? [
        { icon: ArrowUp, label: "in", value: formatTokens(stats.inputTokens), emphasis: "muted" },
        { icon: ArrowDown, label: "out", value: formatTokens(stats.outputTokens), emphasis: "muted" },
        { icon: Timer, label: "ttft", value: formatMs(stats.ttftMs) },
        { icon: Zap, label: "tok/s", value: formatRate(stats.tokensPerSec) },
        { icon: Activity, label: "rt", value: formatMs(stats.latencyMs), emphasis: "muted" },
        { icon: Coins, label: "$", value: formatUsd(stats.cost), emphasis: "primary" },
      ]
    : [];

  return (
    <div
      className={cn(
        "flex w-[420px] shrink-0 flex-col rounded-lg border bg-card/30",
        isReference ? "border-primary/60 ring-1 ring-primary/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border/60 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="truncate font-mono text-sm font-semibold">
              {modelId}
            </span>
            {isReference && (
              <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold uppercase tracking-wider text-primary">
                ref
              </span>
            )}
            <JsonBadge check={jsonCheck} />
          </div>
          {model && (
            <div className="mt-1.5">
              <ModelInfoCard model={model} compact />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={onSetReference}
            disabled={isReference}
            title="Use this response as the diff reference"
            aria-label={`Set ${modelId} as the diff reference`}
            aria-pressed={isReference}
            className="rounded p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:cursor-default disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove from comparison"
            aria-label={`Remove ${modelId} from comparison`}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="border-b border-border/60 px-3 py-2">
        <MiniPinRow pins={pins} />
      </div>

      <div
        className="flex-1 overflow-auto p-3"
        aria-live={run?.isStreaming ? "polite" : undefined}
        aria-busy={run?.isStreaming ? true : undefined}
        aria-label={`Response from ${modelId}`}
      >
        {run?.interrupted && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-yellow-600/30 bg-yellow-500/10 px-2 py-1.5 text-[11px] text-yellow-500"
          >
            <span>interrupted by refresh</span>
            <button
              type="button"
              onClick={onResume}
              className="inline-flex items-center gap-1 rounded-sm border border-yellow-600/50 bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider hover:bg-yellow-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
              resume
            </button>
          </div>
        )}
        {run?.error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {run.error}
          </div>
        ) : !run?.text && run?.isStreaming ? (
          <div className="text-xs italic text-muted-foreground">waiting…</div>
        ) : !run?.text ? (
          <div className="text-xs italic text-muted-foreground">—</div>
        ) : showDiff && diffAgainst !== null ? (
          <DiffPane reference={diffAgainst} candidate={run.text} />
        ) : (
          <RenderedContent
            content={run.text}
            isStreaming={run.isStreaming}
            className="text-xs leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}

function DiffPane({
  reference,
  candidate,
}: {
  reference: string;
  candidate: string;
}) {
  const ops = useMemo(() => lineDiff(reference, candidate), [reference, candidate]);
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
      {ops.map((op, i) => {
        const lines = op.value.split("\n");
        // Last split is empty if value ends in \n; skip rendering it.
        const renderable = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
        return renderable.map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={cn(
              "px-1 -mx-1",
              op.added && "bg-primary/15 text-primary",
              op.removed && "bg-destructive/15 text-destructive line-through opacity-70",
            )}
          >
            <span className="select-none opacity-50 mr-1">
              {op.added ? "+" : op.removed ? "−" : " "}
            </span>
            {line || " "}
          </div>
        ));
      })}
    </pre>
  );
}

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

interface ResultsTableProps {
  modelIds: string[];
  runs: Record<string, CompareRun>;
  models: ModelWithRouting[];
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  sortBy: "model" | "ttft" | "tokps" | "rt" | "cost" | "out";
  sortDir: "asc" | "desc";
  onSort: (col: ResultsTableProps["sortBy"]) => void;
  onRemove: (id: string) => void;
}

function ResultsTable({
  modelIds,
  runs,
  models,
  expandedRow,
  setExpandedRow,
  sortBy,
  sortDir,
  onSort,
  onRemove,
}: ResultsTableProps) {
  const rows = useMemo(() => {
    const rs = modelIds.map((id) => {
      const run = runs[id];
      const model = models.find((m) => m.id === id);
      const stats = run ? statsForRun(run, model) : null;
      return { id, run, model, stats };
    });
    const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
      const aN = a ?? Infinity;
      const bN = b ?? Infinity;
      return aN === bN ? 0 : aN < bN ? -1 : 1;
    };
    const sorted = [...rs].sort((a, b) => {
      switch (sortBy) {
        case "model":
          return a.id.localeCompare(b.id);
        case "ttft":
          return cmpNum(a.stats?.ttftMs, b.stats?.ttftMs);
        case "tokps":
          // higher tok/s is "better"; sort desc by default semantics
          return cmpNum(
            a.stats?.tokensPerSec ? -a.stats.tokensPerSec : null,
            b.stats?.tokensPerSec ? -b.stats.tokensPerSec : null,
          );
        case "rt":
          return cmpNum(a.stats?.latencyMs, b.stats?.latencyMs);
        case "cost":
          return cmpNum(a.stats?.cost, b.stats?.cost);
        case "out":
          return cmpNum(a.stats?.outputTokens, b.stats?.outputTokens);
      }
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [modelIds, runs, models, sortBy, sortDir]);

  function SortHeader({
    col,
    label,
    align = "left",
  }: {
    col: ResultsTableProps["sortBy"];
    label: string;
    align?: "left" | "right";
  }) {
    const active = sortBy === col;
    return (
      <th
        className={cn(
          "cursor-pointer select-none px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground",
          align === "right" && "text-right",
        )}
        onClick={() => onSort(col)}
      >
        {label}
        {active && (
          <span className="ml-1 opacity-70">
            {sortDir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </th>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
            <tr>
              <th className="w-8" />
              <SortHeader col="model" label="model" />
              <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                response
              </th>
              <SortHeader col="out" label="out" align="right" />
              <SortHeader col="ttft" label="ttft" align="right" />
              <SortHeader col="tokps" label="tok/s" align="right" />
              <SortHeader col="rt" label="rt" align="right" />
              <SortHeader col="cost" label="cost" align="right" />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, run, model, stats }) => {
              const expanded = expandedRow === id;
              return (
                <FragmentRow
                  key={id}
                  id={id}
                  run={run}
                  model={model}
                  stats={stats}
                  expanded={expanded}
                  onToggle={() => setExpandedRow(expanded ? null : id)}
                  onRemove={() => onRemove(id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  id,
  run,
  model,
  stats,
  expanded,
  onToggle,
  onRemove,
}: {
  id: string;
  run: CompareRun | undefined;
  model: ModelWithRouting | undefined;
  stats: PerRunStats | null;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const text = run?.text ?? "";
  const preview = text.length > 160 ? text.slice(0, 160) + "…" : text;
  const jsonCheck = checkJson(text, run?.isStreaming ?? false);
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b border-border/40 hover:bg-accent/20",
          run?.error && "bg-destructive/5",
          expanded && "bg-accent/20",
        )}
        onClick={onToggle}
      >
        <td className="px-2 py-1.5 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-2 py-1.5 font-mono">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="truncate max-w-[200px]">{id}</span>
            {run?.isStreaming && (
              <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold uppercase text-primary">
                streaming
              </span>
            )}
            {run?.error && (
              <span className="rounded-sm bg-destructive/15 px-1 text-[9px] font-bold uppercase text-destructive">
                error
              </span>
            )}
            <JsonBadge check={jsonCheck} />
          </div>
          {model?.metadata?.litellm_provider && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {model.metadata.litellm_provider}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground">
          <div className="line-clamp-1 max-w-[480px] font-sans text-[11px]">
            {run?.error ? run.error : preview || "—"}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatTokens(stats.outputTokens) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatMs(stats.ttftMs) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatRate(stats.tokensPerSec) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {stats ? formatMs(stats.latencyMs) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-primary">
          {stats ? formatUsd(stats.cost) : "—"}
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label={`Remove ${id} from comparison`}
            title={`Remove ${id} from comparison`}
            className="text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-card/40">
          <td />
          <td colSpan={8} className="px-3 py-3">
            {run?.error ? (
              <pre
                role="alert"
                className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-destructive"
              >
                {run.error}
              </pre>
            ) : run?.text ? (
              <RenderedContent
                content={run.text}
                isStreaming={run?.isStreaming}
                className="text-[12px] leading-relaxed"
              />
            ) : (
              <span className="italic text-muted-foreground">—</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
