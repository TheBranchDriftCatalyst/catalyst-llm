/**
 * ChatStatsRow — thin horizontal stat strip for a Chat.
 *
 * Wraps CostPins + a streaming indicator. In dense mode, auto-hides
 * when the chat is empty and not streaming so an unused rail stays
 * clean. Use as a fixed-position footer in dense layouts, or as a
 * header strip in standard layouts.
 */
import type { Chat } from "../../react/chat/index.js";
import { CostPins } from "../stats/CostPins.js";
import { cn } from "../shared/utils.js";

export interface ChatStatsRowProps {
  chat: Chat;
  /** Tight rail variant. Compacts the cost pins and auto-hides when
   *  the chat has no activity. */
  dense?: boolean;
  /** When dense + empty + not streaming, force showing the strip
   *  anyway. Default false (auto-hide). */
  showWhenEmpty?: boolean;
  className?: string;
}

export function ChatStatsRow({
  chat,
  dense = false,
  showWhenEmpty = false,
  className,
}: ChatStatsRowProps) {
  const isEmpty = chat.messages.length === 0 && !chat.isStreaming;
  if (dense && isEmpty && !showWhenEmpty) return null;

  return (
    <div
      className={cn(
        "shrink-0 border-t border-border/40 bg-background flex items-center gap-2 overflow-x-auto",
        dense ? "px-2 py-1" : "px-4 py-2",
        className,
      )}
    >
      <CostPins chat={chat} compact={dense} flashOnUpdate={!dense} />
      {chat.isStreaming && (
        <span
          className={cn(
            "ml-auto shrink-0 uppercase animate-pulse text-primary",
            dense
              ? "text-[9px] tracking-[0.22em]"
              : "text-[10px] tracking-wider",
          )}
        >
          {dense ? "◇ streaming" : "streaming…"}
        </span>
      )}
    </div>
  );
}
