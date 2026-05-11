import { User, Bot } from "lucide-react";
import type { ChatTurn } from "../react/chatStore.js";
import { RenderedContent } from "./RenderedContent.js";
import { ReasoningBlock, splitReasoning } from "./ReasoningBlock.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { cn } from "./utils.js";

export interface ChatMessageProps {
  message: ChatTurn;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <article
      className={cn(
        "flex gap-4 p-4",
        isUser ? "bg-muted/30" : "bg-background",
      )}
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="flex-1 space-y-1 overflow-hidden">
        <div className="text-sm font-semibold">
          {isUser ? "You" : "Assistant"}
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
              {isStreaming && !message.content && !message.tool_calls?.length ? (
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
