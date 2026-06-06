/**
 * Inline rendering of one model→tool→model invocation. Used inside
 * <ChatMessage> when a turn carries `tool_calls` records, and
 * standalone in any host that captures `onToolCall` events itself.
 *
 * Visual: a compact card showing the tool name, argument summary,
 * collapsed result, and a duration badge. The full args + result
 * stay one click away in a `<details>` so a chat doesn't drown in
 * 8KB of search-result JSON when the user is just trying to read
 * the assistant's reply.
 *
 * No assumption about specific tool shapes — for known tools (the
 * built-in `web_search` / `browse_page`) we add specialized
 * argument summaries and result previews via small helpers; unknown
 * tools fall back to a generic JSON dump.
 */
import { useState } from "react";
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  Globe,
  ExternalLink,
  AlertTriangle,
  Clock,
  Activity,
  Repeat,
} from "lucide-react";
import type {
  ChatToolCallRecord,
  ToolSubEvent,
} from "../../react/chat/index.js";
import { cn } from "../shared/utils.js";

export interface ToolCallCardProps {
  record: ChatToolCallRecord;
  className?: string;
  /** Default open state (otherwise collapsed for compactness). */
  defaultOpen?: boolean;
  /** Terminal aesthetic. When true the row collapses to a single line:
   *  chevron · wrench · name · status word. Args + result render as
   *  mono pre blocks when expanded. Use inside ChatPanel dense mode. */
  dense?: boolean;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  web_search: Globe,
  browse_page: Globe,
};

export function ToolCallCard({
  record,
  className,
  defaultOpen = false,
  dense = false,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = TOOL_ICONS[record.call.function.name] ?? Wrench;
  const isError = !!record.error;
  const subEvents = record.sub_events ?? [];
  // Quick summary numbers for the collapsed row: how many internal
  // tool calls happened and how many iterations the inner loop went
  // through. Useful for "this research used the council N times"
  // glanceability without expanding.
  const subToolCount = subEvents.filter((e) => e.kind === "tool_call_start").length;
  const subIterCount = subEvents.filter((e) => e.kind === "iteration").length;
  const hasSubEvents = subEvents.length > 0;
  const done = record.finished_at > 0;

  if (dense) {
    return (
      <div
        className={cn(
          "rounded-sm border bg-muted/20 font-mono text-[10px]",
          isError ? "border-destructive/40" : "border-border/60",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:text-primary transition-colors cursor-pointer"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <Icon
            className={cn(
              "h-2.5 w-2.5 shrink-0",
              isError ? "text-destructive" : done ? "text-emerald-500" : "text-primary",
            )}
            aria-hidden="true"
          />
          <span className="truncate text-foreground">
            {record.call.function.name}
          </span>
          {hasSubEvents && (
            <span
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-primary/40 bg-primary/10 px-1 py-0.5 text-[8px] uppercase tracking-wider text-primary"
              title={`${subToolCount} nested · ${subIterCount} iters`}
            >
              <Activity className="h-2 w-2" aria-hidden="true" />
              {subToolCount > 0 && <span className="tabular-nums">{subToolCount}</span>}
            </span>
          )}
          <span
            className={cn(
              "shrink-0 text-[8.5px] uppercase tracking-[0.18em]",
              hasSubEvents ? "" : "ml-auto",
              isError ? "text-destructive" : done ? "text-muted-foreground" : "text-primary",
            )}
          >
            {isError ? "error" : done ? "done" : "running…"}
          </span>
        </button>
        {open && (
          <div className="border-t border-border/40 px-2 py-1.5 space-y-1.5">
            <div>
              <div className="text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground mb-0.5">
                args
              </div>
              <pre className="text-[9.5px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(record.args ?? {}, null, 2)}
              </pre>
            </div>
            {record.error && (
              <div>
                <div className="text-[8.5px] uppercase tracking-[0.22em] text-destructive mb-0.5">
                  error
                </div>
                <pre className="text-[9.5px] text-destructive whitespace-pre-wrap break-all leading-relaxed">
                  {record.error}
                </pre>
              </div>
            )}
            {done && record.result !== undefined && (
              <div>
                <div className="text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground mb-0.5">
                  output
                </div>
                <pre className="text-[9.5px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                  {typeof record.result === "string"
                    ? record.result
                    : JSON.stringify(record.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-card/40 my-2 overflow-hidden",
        isError ? "border-destructive/40 bg-destructive/5" : "border-primary/30",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px]",
          "hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isError ? "text-destructive" : "text-primary",
          )}
          aria-hidden="true"
        />
        <span className="font-mono font-bold">
          {record.call.function.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summarizeArgs(record.call.function.name, record.args)}
        </span>
        {isError && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
        )}
        {hasSubEvents && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent"
            title={`${subToolCount} nested tool calls, ${subIterCount} iterations`}
          >
            <Activity className="h-2.5 w-2.5" aria-hidden="true" />
            reasoning
            {subToolCount > 0 && (
              <span className="ml-0.5 font-mono tabular-nums normal-case tracking-normal">
                ×{subToolCount}
              </span>
            )}
          </span>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground tabular-nums">
          <Clock className="h-2.5 w-2.5" aria-hidden="true" />
          {fmtDuration(record.duration_ms)}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/40 bg-card/20 p-2.5 text-[11px]">
          {/* Args */}
          <div className="mb-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              args
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
              {prettyJson(record.args)}
            </pre>
          </div>

          {/* Result OR error */}
          {record.error ? (
            <div>
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-destructive">
                error
              </div>
              <pre
                role="alert"
                className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-destructive/30 bg-destructive/10 p-2 font-mono text-[10px] leading-relaxed text-destructive"
              >
                {record.error}
              </pre>
            </div>
          ) : (
            <ResultPane name={record.call.function.name} value={record.result} />
          )}

          {/* Sub-agent reasoning trail: events from inner LLMs that
              fired while THIS tool was executing (council members,
              critic, fusion). Collapsed by default — drill in for the
              actual chain of thought. */}
          {hasSubEvents && (
            <SubEventTrail subEvents={subEvents} subToolCount={subToolCount} subIterCount={subIterCount} />
          )}
        </div>
      )}
    </div>
  );
}

function SubEventTrail({
  subEvents,
  subToolCount,
  subIterCount,
}: {
  subEvents: ToolSubEvent[];
  subToolCount: number;
  subIterCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-sm border border-accent/30 bg-accent/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] hover:bg-accent/10 transition-colors"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-accent" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 text-accent" aria-hidden="true" />
        )}
        <Activity className="h-3 w-3 text-accent" aria-hidden="true" />
        <span className="font-bold uppercase tracking-wider text-accent">
          reasoning
        </span>
        <span className="text-muted-foreground">
          {subEvents.length} events
          {subToolCount > 0 ? ` · ${subToolCount} tools` : ""}
          {subIterCount > 0 ? ` · ${subIterCount} iterations` : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-accent/20 p-2 space-y-1.5">
          {subEvents.map((e, i) => (
            <SubEventRow key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubEventRow({ event }: { event: ToolSubEvent }) {
  switch (event.kind) {
    case "token":
      return (
        <div className="whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/85">
          {event.content}
        </div>
      );
    case "reasoning":
      return (
        <div className="whitespace-pre-wrap break-words rounded-sm bg-muted/40 px-1.5 py-1 font-mono text-[10px] italic text-muted-foreground">
          <span className="mr-1 not-italic opacity-60">thinking:</span>
          {event.content}
        </div>
      );
    case "iteration":
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Repeat className="h-2.5 w-2.5 text-accent" aria-hidden="true" />
          <span className="uppercase tracking-wider">iteration {event.n}</span>
        </div>
      );
    case "tool_call_start":
      return (
        <div className="flex items-center gap-1.5 rounded-sm border border-primary/20 bg-primary/5 px-1.5 py-1 text-[10px]">
          <Wrench className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
          <span className="font-mono font-bold text-primary">{event.name}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summarizeArgs(event.name, event.args)}
          </span>
        </div>
      );
    case "tool_call_end":
      return (
        <div
          className={cn(
            "flex items-center gap-1.5 px-1.5 py-1 text-[10px] text-muted-foreground",
            event.error ? "text-destructive" : "",
          )}
        >
          <Clock className="h-2.5 w-2.5" aria-hidden="true" />
          <span>
            ↳ {event.error ? "errored" : "returned"} in{" "}
            {fmtDuration(event.duration_ms)}
          </span>
        </div>
      );
  }
}

// ─── Summary helpers ──────────────────────────────────────────────────

function summarizeArgs(toolName: string, args: unknown): string {
  if (toolName === "web_search" && args && typeof args === "object" && args !== null) {
    const a = args as { query?: string; n?: number };
    if (a.query) {
      const tail = a.n ? ` · n=${a.n}` : "";
      return `"${a.query}"${tail}`;
    }
  }
  if (toolName === "browse_page" && args && typeof args === "object" && args !== null) {
    const a = args as { url?: string };
    if (a.url) return a.url;
  }
  if (typeof args === "string") return args;
  if (args && typeof args === "object") {
    return JSON.stringify(args).slice(0, 80);
  }
  return "";
}

function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Result panes — specialized for built-in tools ────────────────────

function ResultPane({ name, value }: { name: string; value: unknown }) {
  if (name === "web_search" && isWebSearchResponse(value)) {
    return <WebSearchResultPane value={value} />;
  }
  return (
    <div>
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        result
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

interface WebSearchResultLike {
  query: string;
  results: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    engine?: string;
  }>;
}

function isWebSearchResponse(v: unknown): v is WebSearchResultLike {
  return (
    !!v &&
    typeof v === "object" &&
    "results" in v &&
    Array.isArray((v as any).results)
  );
}

function WebSearchResultPane({ value }: { value: WebSearchResultLike }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>results</span>
        <span className="opacity-60">({value.results.length})</span>
      </div>
      <ol className="space-y-1.5">
        {value.results.map((r, i) => (
          <li key={i} className="rounded-sm border border-border/40 bg-card/30 p-1.5">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <span className="line-clamp-2">
                {r.title || r.url || "(untitled)"}
              </span>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            </a>
            {r.url && (
              <div className="truncate font-mono text-[9px] text-muted-foreground/80">
                {r.url}
              </div>
            )}
            {r.snippet && (
              <p className="mt-0.5 line-clamp-3 text-[10px] leading-snug text-muted-foreground">
                {r.snippet}
              </p>
            )}
            {r.engine && (
              <span className="mt-0.5 inline-block rounded-sm bg-primary/10 px-1 text-[8px] font-bold uppercase text-primary/80">
                {r.engine}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
