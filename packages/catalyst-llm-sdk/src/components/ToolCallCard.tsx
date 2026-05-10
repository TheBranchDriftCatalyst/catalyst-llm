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
} from "lucide-react";
import type { ChatToolCallRecord } from "../react/chatStore.js";
import { cn } from "./utils.js";

export interface ToolCallCardProps {
  record: ChatToolCallRecord;
  className?: string;
  /** Default open state (otherwise collapsed for compactness). */
  defaultOpen?: boolean;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  web_search: Globe,
  browse_page: Globe,
};

export function ToolCallCard({
  record,
  className,
  defaultOpen = false,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = TOOL_ICONS[record.call.function.name] ?? Wrench;
  const isError = !!record.error;

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
        </div>
      )}
    </div>
  );
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
