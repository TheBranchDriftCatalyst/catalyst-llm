/**
 * ChatMessageList — scrollable message feed for a Chat.
 *
 * Extracted from ChatPanel so consumers can compose their own chat
 * layouts (operator chat rail, full-page chat, side-by-side compare,
 * etc.) without inheriting the kitchen-sink ChatPanel layout. Renders
 * one ChatMessage per turn, auto-scrolls to bottom on append, and
 * provides a dense / standard empty-state.
 *
 * Use directly:
 *   <ChatMessageList chat={activeChat} dense />
 *
 * Use with custom empty state:
 *   <ChatMessageList chat={chat} renderEmpty={() => <MyEmpty />} />
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Card, CardContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/card";
import type { Chat } from "../../react/chat/index.js";
import { ChatMessage } from "./ChatMessage.js";
import { cn } from "../shared/utils.js";

export interface ChatMessageListProps {
  chat: Chat;
  /** Dense (rail) variant — tight ChatMessage padding, mono empty state. */
  dense?: boolean;
  /** Override the empty state. When provided, replaces the default
   *  "Start a conversation" / "Select a model" card. */
  renderEmpty?: (chat: Chat) => ReactNode;
  className?: string;
}

export function ChatMessageList({
  chat,
  dense = false,
  renderEmpty,
  className,
}: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Scroll to the latest message whenever a token / call / error
  // lands. Smooth here is fine — most appends are mid-stream and the
  // smooth scroll keeps the experience calm.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages.length, chat.isStreaming]);

  if (chat.messages.length === 0) {
    return (
      <div className={cn("flex-1 overflow-y-auto", className)}>
        {renderEmpty ? (
          renderEmpty(chat)
        ) : dense ? (
          <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {chat.model ? "send to begin" : "select model"}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Card interactive={false} className="max-w-md">
              <CardContent className="pt-6 text-center">
                <p className="text-lg font-medium mb-2">
                  {chat.model ? "Start a conversation" : "Select a model"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {chat.model
                    ? `Type a message below to begin chatting with ${chat.model}`
                    : "Choose a model from the sidebar to get started"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex-1 overflow-y-auto", className)}>
      <div
        className={
          dense
            ? "divide-y divide-border/10"
            : "divide-y divide-border"
        }
      >
        {chat.messages.map((message, idx) => (
          <ChatMessage
            key={message.id}
            message={message}
            isStreaming={chat.isStreaming && idx === chat.messages.length - 1}
            dense={dense}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
