/**
 * NodeRunsList — the right-side Sheet body that surfaces the recent
 * runs touching a single topology node.
 *
 * Wire path:
 *   1. Operator clicks the History icon on an AgentNodeCard / ToolsNodeCard.
 *   2. ReactFlowAgentTopology calls `onOpenRunsSheet(nodeId)`.
 *   3. EngineView flips `sheetContext` to { kind: "runs", agentId, nodeId }.
 *   4. EngineView renders `<NodeRunsList agentId nodeId />` inside the Sheet.
 *   5. This component fetches GET /api/runs/by-node and renders rows.
 *
 * `agentId` is informational — the backend's runs_by_node() filters on
 * the node label only (events table has no agent_id column). We still
 * pass it so future per-agent scoping is a one-line backend change.
 *
 * Click semantics: a clicked row currently `console.log`s the run_id;
 * routing to a run-detail view is out of scope for llm-jui.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, History, Loader2, Play, XCircle } from "lucide-react";
import type { RunByNodeRow } from "../../agent/events.js";
import { useLLMContext } from "../../react/LLMProvider.js";
import { cn } from "../utils.js";

export interface NodeRunsListProps {
  /** Informational — see file header. Forwarded to the API as
   * `agent_id` but the server doesn't use it for filtering today. */
  agentId: string;
  nodeId: string;
  /** Max rows requested from the API. Defaults to 20 (matches the
   * server's default). */
  limit?: number;
  className?: string;
}

function StatusIcon({ row }: { row: RunByNodeRow }) {
  if (row.had_error) {
    return (
      <XCircle
        className="h-4 w-4 shrink-0 text-destructive"
        aria-label="error"
      />
    );
  }
  if (row.completed) {
    return (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-emerald-400"
        aria-label="completed"
      />
    );
  }
  return (
    <Play
      className="h-4 w-4 shrink-0 text-muted-foreground"
      aria-label="in progress"
    />
  );
}

/** Format epoch-seconds as a relative-ish timestamp.
 *  - < 60s → "just now"
 *  - < 60m → "Xm ago"
 *  - < 24h → "Xh ago"
 *  - else  → absolute (local) date/time
 *
 * Kept inline + dependency-free; we can swap to date-fns later if a
 * second component needs the same logic.
 */
function formatRelative(epochSeconds: number): string {
  const ms = epochSeconds * 1000;
  if (!Number.isFinite(ms)) return "—";
  const diffSec = (Date.now() - ms) / 1000;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return new Date(ms).toLocaleString();
}

export function NodeRunsList({
  agentId,
  nodeId,
  limit = 20,
  className,
}: NodeRunsListProps) {
  const { agentClient } = useLLMContext();
  const [rows, setRows] = useState<RunByNodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentClient) {
      // No backend wired up — render the empty state so the operator
      // still gets a clue about what the Sheet would show.
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await agentClient.listRunsByNode(nodeId, agentId, limit);
      setRows(data.runs);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [agentClient, agentId, nodeId, limit]);

  // Refetch whenever the operator hops to a different node — the Sheet
  // body remounts but the EngineView keeps the Sheet open across
  // changes so we lean on the dep array rather than mount semantics.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Recent runs</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          Failed to load runs: {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border/60 bg-card/30 p-3 text-sm text-muted-foreground">
          No runs have touched <code className="font-mono">{nodeId}</code> yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.run_id}>
              <button
                type="button"
                onClick={() => {
                  // Routing to a run-detail view is out of scope for
                  // llm-jui; surface the id for now so devtools can
                  // grab it and we don't break the wiring downstream.
                  // eslint-disable-next-line no-console
                  console.log("NodeRunsList: run selected", row.run_id);
                }}
                className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-card/80"
                title={`run_id: ${row.run_id}`}
              >
                <StatusIcon row={row} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-foreground">
                    {row.run_id}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatRelative(row.last_ts)} · {row.event_count}{" "}
                    {row.event_count === 1 ? "event" : "events"}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
