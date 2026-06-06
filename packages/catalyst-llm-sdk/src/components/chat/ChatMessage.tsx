import { AlertTriangle, OctagonX, User, Bot } from "lucide-react";
import type { ChatTurn } from "../../react/chat/index.js";
import { RenderedContent } from "../shared/RenderedContent.js";
import { ReasoningBlock, splitReasoning } from "./ReasoningBlock.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { cn } from "../shared/utils.js";

export interface ChatMessageProps {
  message: ChatTurn;
  isStreaming?: boolean;
  /** Terminal / command-center aesthetic. When true, the message uses
   *  a tight monospace layout: tracking-wide YOU/AGENT label, bordered
   *  accent box for user content, plain mono text for assistant
   *  responses, hairline separators throughout, no avatars. Designed
   *  for narrow rail surfaces (~380px). Defaults to false, which keeps
   *  the legacy two-column avatar layout for standalone full-page use. */
  dense?: boolean;
}

export function ChatMessage({ message, isStreaming, dense = false }: ChatMessageProps) {
  if (dense) return <DenseChatMessage message={message} isStreaming={isStreaming} />;

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <article
      className={cn(
        "flex",
        dense ? "gap-2 p-2" : "gap-4 p-4",
        isUser ? "bg-muted/30" : "bg-background",
      )}
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          dense ? "h-5 w-5" : "h-8 w-8",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {isUser ? (
          <User className={dense ? "h-2.5 w-2.5" : "h-4 w-4"} />
        ) : (
          <Bot className={dense ? "h-2.5 w-2.5" : "h-4 w-4"} />
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-hidden">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span>{isUser ? "You" : "Assistant"}</span>
          {/* Cooperative-stop indicator. When finish_reason="abort"
              the server caught a STOP press and propagated cancel to
              sub-agents (see Cancelled event in events.py). The badge
              tells the user the stop was structured — not the
              connection just dropping — and how many sub-agents
              heard it. */}
          {isAssistant && message.meta?.finish_reason === "abort" && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-muted-foreground/30 bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
              title={
                message.meta.cancel_propagated_to?.length
                  ? `stop propagated to ${message.meta.cancel_propagated_to.length} sub-agent${message.meta.cancel_propagated_to.length === 1 ? "" : "s"}`
                  : "stopped"
              }
            >
              <OctagonX className="h-2.5 w-2.5" aria-hidden="true" />
              stopped
              {message.meta.cancel_propagated_to &&
                message.meta.cancel_propagated_to.length > 0 && (
                  <span className="ml-0.5 font-mono normal-case tracking-normal tabular-nums">
                    ×{message.meta.cancel_propagated_to.length}
                  </span>
                )}
            </span>
          )}
        </div>
        <div
          // Stream tokens are announced politely as they land. `aria-busy`
          // tells SRs the region is still updating so they don't fire on
          // every chunk.
          aria-live={isAssistant && isStreaming ? "polite" : undefined}
          aria-busy={isAssistant && isStreaming ? true : undefined}
        >
          {isAssistant ? (
            <>
              {/* Router-picked chip (op-w76). Hidden when picks is
                  empty or undefined — i.e., the router either wasn't
                  used or fell back to defaults and didn't actually
                  add anything. Same suppression semantics as the
                  operator's chip so we never show a chip "for show". */}
              {message.routerPicks && message.routerPicks.length > 0 && (
                <div
                  data-testid="router-selected-chip"
                  className="mb-2 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  <span className="text-primary">⌥ router picked</span>
                  {message.routerPicks.map((t) => (
                    <span
                      key={t}
                      className="rounded-sm border border-border/40 bg-muted/30 px-1.5 py-0.5 text-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {/* Reasoning event accumulator (op-w76). Distinct from
                  the <think>-tag splitter below: this slot is for
                  backends that emit reasoning deltas as their own
                  event stream, never mixed into content. Rendered
                  above the answer so the user can read it before the
                  conclusion. */}
              {message.reasoning && (
                <ReasoningBlock
                  content={message.reasoning}
                  isStreaming={
                    !!isStreaming && !message.content && !message.error
                  }
                />
              )}
              {/* Tool invocations land before / between content chunks
                  in the multi-iteration loop; render them inline so
                  the user sees the "model searched, then read this
                  page, then answered" trail. */}
              {message.tool_calls?.map((rec, i) => (
                <ToolCallCard
                  key={`${rec.call.id}-${i}`}
                  record={rec}
                />
              ))}
              {isStreaming && !message.content && !message.tool_calls?.length && !message.error ? (
                <span className="text-muted-foreground">Thinking...</span>
              ) : (
                /*
                  Split <think>...</think> reasoning traces out of the
                  content stream and render them in collapsible blocks
                  alongside the actual answer. Reasoning distills
                  (deepseek-r1, qwen3-coder-opus, qwen3 thinking
                  variants) emit these inline; without splitting they
                  drown the real answer in chain-of-thought prose.
                */
                splitReasoning(message.content).map((seg, i) =>
                  seg.kind === "thinking" ? (
                    <ReasoningBlock
                      key={`r-${i}`}
                      content={seg.content}
                      isStreaming={!!seg.partial}
                    />
                  ) : (
                    <RenderedContent
                      key={`t-${i}`}
                      content={seg.content}
                      isStreaming={isStreaming}
                    />
                  ),
                )
              )}
              {/* Per-turn error from the SSE `error` event (e.g. the
                  upstream model rejected the request). Rendered after
                  any partial text so the user sees what survived
                  before the failure plus the reason it stopped. */}
              {message.error && (
                <div
                  role="alert"
                  className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="whitespace-pre-wrap break-words">
                    {message.error}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm">
              {message.content}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Dense (terminal command-center) variant ─────────────────────────
//
// Tight monospace layout for narrow rail surfaces. No avatars. Micro
// tracking-wide YOU/AGENT label, bordered accent box for user content,
// plain mono text for assistant responses. Reuses ReasoningBlock,
// ToolCallCard, and RenderedContent — all of which honor a ``dense``
// prop themselves — so the entire message tree is rail-friendly.

interface DenseChatMessageProps {
  message: ChatTurn;
  isStreaming?: boolean;
}

function DenseChatMessage({ message, isStreaming }: DenseChatMessageProps) {
  const isUser = message.role === "user";
  return (
    <li className="flex flex-col gap-1.5 px-2 py-1.5">
      <div
        className={cn(
          "text-[8.5px] uppercase tracking-[0.22em]",
          isUser ? "text-primary" : "text-muted-foreground",
        )}
      >
        {isUser ? "you" : "agent"}
        {!isUser && isStreaming && (
          <span className="ml-1 animate-pulse text-primary">◇</span>
        )}
      </div>

      {/* Router-picked chip (op-w76). Hidden when picks is empty. */}
      {!isUser && message.routerPicks && message.routerPicks.length > 0 && (
        <div
          data-testid="router-selected-chip"
          className="flex flex-wrap items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span className="text-primary">⌥ router picked</span>
          {message.routerPicks.map((t) => (
            <span
              key={t}
              className="rounded-sm border border-border/60 bg-muted/30 px-1.5 py-0.5 text-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Reasoning field (event-stream deltas) — separate from
          <think>-tag splitter below. */}
      {!isUser && message.reasoning && (
        <ReasoningBlock
          content={message.reasoning}
          isStreaming={!!isStreaming && !message.content && !message.error}
          dense
        />
      )}

      {/* Tool calls (op-w76 + sub_events). Single-line collapsibles
          in dense mode — chevron + wrench + name + status word. */}
      {!isUser &&
        message.tool_calls?.map((rec, i) => (
          <ToolCallCard
            key={`${rec.call.id}-${i}`}
            record={rec}
            dense
          />
        ))}

      {/* Message content. User: bordered orange-tinted box. Agent:
          plain mono with subtle elevation. Split <think> tags inline
          for reasoning models that emit them as content. */}
      {isUser ? (
        <div className="rounded-sm border border-primary/40 bg-primary/[0.06] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      ) : isStreaming && !message.content && !message.tool_calls?.length && !message.error ? (
        <span className="px-2 font-mono text-[10.5px] italic text-muted-foreground">
          ...
        </span>
      ) : message.content ? (
        <div className="px-1 font-mono text-[10.5px] leading-relaxed text-foreground">
          {splitReasoning(message.content).map((seg, i) =>
            seg.kind === "thinking" ? (
              <ReasoningBlock
                key={`r-${i}`}
                content={seg.content}
                isStreaming={!!seg.partial}
                dense
              />
            ) : (
              <RenderedContent
                key={`t-${i}`}
                content={seg.content}
                isStreaming={isStreaming}
              />
            ),
          )}
        </div>
      ) : null}

      {/* Per-turn error. */}
      {message.error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-sm border border-destructive/40 bg-destructive/[0.08] px-2 py-1 font-mono text-[10.5px] text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-pre-wrap break-words">{message.error}</span>
        </div>
      )}

      {/* Cooperative-stop badge — kept in dense so the user sees the
          STOP was structured, not a connection drop. */}
      {message.role === "assistant" && message.meta?.finish_reason === "abort" && (
        <span
          className="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
          title={
            message.meta.cancel_propagated_to?.length
              ? `stop propagated to ${message.meta.cancel_propagated_to.length} sub-agent${message.meta.cancel_propagated_to.length === 1 ? "" : "s"}`
              : "stopped"
          }
        >
          <OctagonX className="h-2 w-2" aria-hidden="true" />
          stopped
          {message.meta.cancel_propagated_to &&
            message.meta.cancel_propagated_to.length > 0 && (
              <span className="ml-0.5 font-mono normal-case tracking-normal tabular-nums">
                ×{message.meta.cancel_propagated_to.length}
              </span>
            )}
        </span>
      )}
    </li>
  );
}
