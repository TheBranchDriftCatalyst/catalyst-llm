import { AlertTriangle, OctagonX, User, Bot } from "lucide-react";
import type { Chat, ChatTurn } from "../../react/chat/index.js";
import { useModels } from "../../react/hooks.js";
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
  /** Optional full chat context. When provided in dense mode, the
   *  assistant role-row gets a TTFT sparkline (PRO1) and each assistant
   *  turn gets a per-turn + cumulative cost micro-row (PRO2). */
  chat?: Chat;
  /** Index of this message inside `chat.messages`. Used to compute the
   *  cumulative cost up-to-and-including this turn. */
  messageIndex?: number;
}

export function ChatMessage({
  message,
  isStreaming,
  dense = false,
  chat,
  messageIndex,
}: ChatMessageProps) {
  if (dense)
    return (
      <DenseChatMessage
        message={message}
        isStreaming={isStreaming}
        chat={chat}
        messageIndex={messageIndex}
      />
    );

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
  chat?: Chat;
  messageIndex?: number;
}

function DenseChatMessage({
  message,
  isStreaming,
  chat,
  messageIndex,
}: DenseChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  // PRO1: TTFT sparkline — derive a series of per-turn ttft_ms values
  // from the chat history. Only assistant turns with `meta.ttft_ms`
  // contribute; we draw a flat polyline when the series is empty so
  // the slot is reserved (helps avoid layout jitter on first answer).
  const ttftSeries: number[] = isAssistant && chat ? collectTtftSeries(chat) : [];

  // PRO2: per-turn cost + cumulative. We walk the chat up to and
  // including this message index, summing assistant-turn usage
  // multiplied by the per-turn model price (turn.meta.model overrides
  // chat.model when present — matches useChatCost's logic).
  const { models } = useModels();
  const turnCost =
    isAssistant && chat && typeof messageIndex === "number"
      ? perTurnCost(chat, messageIndex, models)
      : null;
  const cumulativeCost =
    isAssistant && chat && typeof messageIndex === "number"
      ? cumulativeUpTo(chat, messageIndex, models)
      : null;

  return (
    <li className="flex flex-col gap-1 px-2 py-1.5">
      <div
        className={cn(
          "text-[8.5px] uppercase tracking-[0.22em] flex items-center gap-1.5 whitespace-nowrap",
          isUser ? "text-primary" : "text-muted-foreground",
        )}
        data-testid={isUser ? "chat-role-user" : "chat-role-agent"}
      >
        <span className="shrink-0">{isUser ? "you" : "agent"}</span>
        {!isUser && isStreaming && (
          <span className="animate-pulse text-primary shrink-0">◇</span>
        )}
        {isAssistant && chat && (
          <TtftSparkline series={ttftSeries} />
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

      {/* Message content. User: a marked-up quote — barely-there primary
          tint + a 2px primary-accent left rail. Reads as "this is what
          you asked", not as a button. Agent: floating mono text, no
          chrome — relies on the role label + divide-y between turns
          for rhythm. */}
      {isUser ? (
        <div className="rounded-sm bg-primary/[0.04] border-l-2 border-primary/40 px-2 py-1 font-mono text-[10.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </div>
      ) : isStreaming && !message.content && !message.tool_calls?.length && !message.error ? (
        <span className="px-1 font-mono text-[10.5px] italic text-muted-foreground animate-pulse">
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

      {/* PRO2: per-turn cost delta + cumulative. Hidden when the
          cumulative is exactly zero (local model / no usage logged). */}
      {isAssistant && turnCost !== null && cumulativeCost !== null && cumulativeCost > 0 && (
        <div
          data-testid="chat-turn-cost"
          className={cn(
            "text-[8.5px] uppercase tracking-[0.22em] px-1 whitespace-nowrap tabular-nums",
            costColorClass(turnCost),
          )}
        >
          · {formatTinyUsd(turnCost)} · Σ {formatTinyUsd(cumulativeCost)}
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

// ── PRO1: TTFT sparkline ──────────────────────────────────────────────
//
// Inline 32×8 svg next to the AGENT label. Walks chat history,
// pulls each assistant turn's `meta.ttft_ms` (when present), and
// plots a polyline normalized to the local min/max. With <2 data
// points we draw a flat midline so the slot is still visually
// reserved and the test target is always mountable.

const SPARK_W = 32;
const SPARK_H = 8;

function collectTtftSeries(chat: Chat): number[] {
  const out: number[] = [];
  for (const turn of chat.messages) {
    if (turn.role !== "assistant") continue;
    const m = turn.meta as (typeof turn.meta & { ttft_ms?: number }) | undefined;
    const ttft = typeof m?.ttft_ms === "number" ? m.ttft_ms : null;
    if (ttft !== null && ttft >= 0) out.push(ttft);
  }
  return out;
}

function TtftSparkline({ series }: { series: number[] }) {
  // Take last 12 samples max so the chart doesn't squish to noise.
  const samples = series.slice(-12);
  let points: string;
  if (samples.length < 2) {
    // Flat midline reserves the slot even when we have no data yet.
    const y = SPARK_H / 2;
    points = `0,${y} ${SPARK_W},${y}`;
  } else {
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const span = max - min || 1;
    const stride = SPARK_W / (samples.length - 1);
    points = samples
      .map((v, i) => {
        const x = i * stride;
        // Invert Y so larger TTFT = lower on screen (faster = higher).
        const y = SPARK_H - ((v - min) / span) * SPARK_H;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }
  return (
    <svg
      data-testid="chat-ttft-spark"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0 opacity-40"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── PRO2: per-turn cost helpers ───────────────────────────────────────

function priceForTurn(
  turn: ChatTurn,
  chatModel: string,
  models: ReturnType<typeof useModels>["models"],
): { input: number; output: number } {
  const wanted = turn.meta?.model ?? chatModel;
  const m = models.find((mm) => mm.id === wanted);
  return {
    input: m?.metadata?.input_cost_per_token ?? 0,
    output: m?.metadata?.output_cost_per_token ?? 0,
  };
}

function perTurnCost(
  chat: Chat,
  idx: number,
  models: ReturnType<typeof useModels>["models"],
): number | null {
  const turn = chat.messages[idx];
  if (!turn || turn.role !== "assistant") return null;
  const usage = turn.meta?.usage;
  if (!usage) return null;
  const price = priceForTurn(turn, chat.model, models);
  return (
    price.input * (usage.prompt_tokens ?? 0) +
    price.output * (usage.completion_tokens ?? 0)
  );
}

function cumulativeUpTo(
  chat: Chat,
  idx: number,
  models: ReturnType<typeof useModels>["models"],
): number {
  let sum = 0;
  for (let i = 0; i <= idx && i < chat.messages.length; i++) {
    const t = chat.messages[i];
    if (t.role !== "assistant") continue;
    const usage = t.meta?.usage;
    if (!usage) continue;
    const price = priceForTurn(t, chat.model, models);
    sum +=
      price.input * (usage.prompt_tokens ?? 0) +
      price.output * (usage.completion_tokens ?? 0);
  }
  return sum;
}

function costColorClass(cost: number): string {
  if (cost < 0.01) return "text-ok";
  if (cost < 0.05) return "text-warn";
  return "text-alert";
}

function formatTinyUsd(n: number): string {
  if (n === 0) return "$0.0000";
  // Always show 4 decimals — the micro-row is the place where deltas
  // smaller than a cent matter. Larger costs still read cleanly because
  // the value column is mono and right-aligned by the surrounding flow.
  return `$${n.toFixed(4)}`;
}
