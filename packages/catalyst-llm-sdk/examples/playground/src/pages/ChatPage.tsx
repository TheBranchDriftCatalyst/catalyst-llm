/**
 * Chat tab — the playground's primary surface. Renders ChatTabs
 * across the top (chat list + new-chat affordance) and ChatPanel
 * for the active chat. "Export to compare" is wired via `onNavigate`
 * so the parent can swap routes without ChatPage knowing about the
 * compare tab's existence.
 */
import { MessageSquare } from "lucide-react";
import { ChatPanel, ChatTabs, useChatStore } from "@catalyst/llm-sdk";
import type { PageMeta, PageProps } from "./types.js";

export function ChatPage({ onNavigate }: PageProps) {
  const { chats, activeChat } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  return (
    <>
      <ChatTabs onExportToCompare={() => onNavigate?.("compare")} />
      <main id="main-content" className="flex-1 overflow-hidden">
        {current ? (
          <ChatPanel key={current.id} chat={current} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No chat selected
          </div>
        )}
      </main>
    </>
  );
}

export const chatPageMeta: PageMeta = {
  id: "chat",
  label: "Chat",
  icon: MessageSquare,
  path: "/chat",
  useStreamingIndicator: () => {
    const chats = useChatStore((s) => s.chats);
    return chats.some((c) => c.isStreaming);
  },
  component: ChatPage,
};
