import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "../shared/utils.js";

export interface ReasoningBlockProps {
  /** The raw text inside the <think>...</think> tags (no tags). */
  content: string;
  /** True if the model is still streaming this reasoning trace
   * (the closing </think> hasn't arrived). Shown via a small
   * "thinking..." affordance + auto-expanded by default. */
  isStreaming?: boolean;
  /** Whether to expand by default. Defaults to false — reasoning
   * traces are noisy and we don't want them to dominate the chat
   * surface. The "thinking…" indicator in the collapsed header
   * still shows the user that something is happening during stream. */
  defaultOpen?: boolean;
  /** Terminal aesthetic: tight monospace, ◇ glyph instead of Brain
   *  icon, micro tracking-wide summary, hairline border. Used when
   *  mounted inside a rail-friendly ChatPanel dense mode. */
  dense?: boolean;
}

/**
 * Collapsible visualizer for a model's reasoning trace. Reasoning
 * distills (deepseek-r1, qwen3-coder-opus, qwen3 thinking variants,
 * etc.) emit a `<think>…</think>` block before the actual answer.
 * Splitting it out keeps the chat readable while still giving the
 * user a way to inspect the model's chain of thought.
 */
export function ReasoningBlock({
  content,
  isStreaming = false,
  defaultOpen = false,
  dense = false,
}: ReasoningBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = content.trim();
  if (!trimmed && !isStreaming) return null;

  if (dense) {
    return (
      <div className="rounded-sm border border-border/60 bg-muted/20 font-mono text-[10px]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[9px] uppercase tracking-[0.22em] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          aria-expanded={open}
        >
          <span className="text-primary">◇</span>
          <span>reasoning</span>
          {isStreaming && (
            <span className="ml-1 text-primary/70 italic normal-case tracking-normal animate-pulse">
              thinking…
            </span>
          )}
          {!isStreaming && trimmed && (
            <span className="ml-1 text-muted-foreground/60 normal-case tracking-normal tabular-nums">
              {trimmed.length.toLocaleString()}c
            </span>
          )}
        </button>
        {open && (
          <pre className="border-t border-border/40 px-2 py-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-muted-foreground italic">
            {trimmed || (isStreaming ? "…" : "")}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "my-2 rounded-md border border-border/60 bg-muted/40",
        "text-sm",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5",
          "text-left text-xs font-medium text-muted-foreground",
          "hover:text-foreground transition-colors",
          "cursor-pointer",
        )}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
        <Brain className="h-3.5 w-3.5" />
        <span>Reasoning</span>
        {isStreaming && (
          <span className="ml-1 text-muted-foreground/60 italic">
            thinking…
          </span>
        )}
        {!isStreaming && trimmed && (
          <span className="ml-1 text-muted-foreground/60">
            ({trimmed.length.toLocaleString()} chars)
          </span>
        )}
      </button>
      {open && (
        <div
          className={cn(
            "border-t border-border/60 px-3 py-2",
            "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed",
            "text-muted-foreground",
          )}
        >
          {trimmed || (isStreaming ? "…" : "")}
        </div>
      )}
    </div>
  );
}

/**
 * Split a message body into alternating text and reasoning segments.
 * Handles partial (still-streaming) `<think>` blocks: an opening tag
 * without a matching close emits a final `kind: "thinking"` segment
 * flagged `partial: true`.
 *
 * Returns segments in original order so consumers can render them
 * inline with the model's actual trace flow (some models emit a
 * mid-response reasoning aside; we don't reorder).
 */
export interface ContentSegment {
  kind: "text" | "thinking";
  content: string;
  /** True for the trailing segment when streaming hasn't closed it yet. */
  partial?: boolean;
}

const OPEN = "<think>";
const CLOSE = "</think>";

export function splitReasoning(raw: string): ContentSegment[] {
  if (!raw || !raw.includes(OPEN)) {
    return raw ? [{ kind: "text", content: raw }] : [];
  }
  const out: ContentSegment[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const openAt = raw.indexOf(OPEN, cursor);
    if (openAt === -1) {
      const rest = raw.slice(cursor);
      if (rest) out.push({ kind: "text", content: rest });
      break;
    }
    if (openAt > cursor) {
      out.push({ kind: "text", content: raw.slice(cursor, openAt) });
    }
    const innerStart = openAt + OPEN.length;
    const closeAt = raw.indexOf(CLOSE, innerStart);
    if (closeAt === -1) {
      // Unclosed — still streaming this reasoning trace.
      out.push({
        kind: "thinking",
        content: raw.slice(innerStart),
        partial: true,
      });
      break;
    }
    out.push({
      kind: "thinking",
      content: raw.slice(innerStart, closeAt),
    });
    cursor = closeAt + CLOSE.length;
  }
  return out;
}
