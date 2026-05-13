/**
 * One response card in the compare-mode grid. Owns the header
 * (model id + JSON-validity badge + reference/remove buttons), the
 * stats pin row, and the body (streaming/error/diff/markdown).
 */
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Coins,
  GitCompareArrows,
  RotateCcw,
  Timer,
  X,
  Zap,
} from "lucide-react";
import type { ModelWithRouting } from "../../client/index.js";
import {
  formatMs,
  formatRate,
  formatTokens,
  formatUsd,
} from "../../react/useChatCost.js";
import type { CompareRun } from "../../react/useCompare.js";
import { ModelInfoCard } from "../ModelInfoCard.js";
import { RenderedContent } from "../RenderedContent.js";
import { checkJson, statsForRun } from "./compare-stats.js";
import { JsonBadge, MiniPinRow, type MiniPin } from "./compare-stats-ui.js";
import { DiffPane } from "./compare-diff-pane.js";
import { cn } from "../utils.js";

export interface ResponseColumnProps {
  modelId: string;
  run: CompareRun | undefined;
  model: ModelWithRouting | undefined;
  isReference: boolean;
  onRemove: () => void;
  onSetReference: () => void;
  onResume: () => void;
  diffAgainst: string | null;
}

export function ResponseColumn({
  modelId,
  run,
  model,
  isReference,
  onRemove,
  onSetReference,
  onResume,
  diffAgainst,
}: ResponseColumnProps) {
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
