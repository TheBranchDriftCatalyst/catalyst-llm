/**
 * ChatHeader — compact controls strip for a Chat (dense rail).
 *
 * Renders the model micro-switcher + a configurable action cluster on
 * the right. By default: a gear toggle (settings flip), a trash button
 * (clear chat). Hosts can replace either with custom actions or hide
 * them entirely.
 *
 * Used by ChatPanel's dense mode and operator chat rails. The settings
 * flip is implemented at the host level: pass ``view`` + ``onViewChange``
 * to control the active view; the header swaps gear ↔ X based on it.
 */
import type { ReactNode } from "react";
import { Settings, Trash2, X } from "lucide-react";
import { useChatStore, type Chat } from "../../react/chat/index.js";
import { ModelMicroSwitcher } from "../model-selector/ModelMicroSwitcher.js";
import { cn } from "../shared/utils.js";

export type ChatHeaderView = "chat" | "settings";

export interface ChatHeaderProps {
  chat: Chat;
  /** Active view (chat or settings). Controls whether the gear or
   *  X icon shows on the right cluster. */
  view?: ChatHeaderView;
  /** Called when the gear/X is clicked. Hosts implement the flip. */
  onViewChange?: (next: ChatHeaderView) => void;
  /** Hide the model micro-switcher (when the host renders its own). */
  hideModelSwitcher?: boolean;
  /** Append extra controls before the gear/trash cluster. */
  extras?: ReactNode;
  className?: string;
}

export function ChatHeader({
  chat,
  view = "chat",
  onViewChange,
  hideModelSwitcher = false,
  extras,
  className,
}: ChatHeaderProps) {
  const { setModel, clearChat } = useChatStore();
  const inSettings = view === "settings";

  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-border/20 bg-background px-2 py-1",
        className,
      )}
    >
      {!hideModelSwitcher && (
        <div className="flex-1 min-w-0">
          <ModelMicroSwitcher
            value={chat.model}
            onChange={(model) => setModel(chat.id, model)}
          />
        </div>
      )}
      {extras}
      {inSettings ? (
        <button
          type="button"
          onClick={() => onViewChange?.("chat")}
          title="back to chat"
          aria-label="back to chat"
          className="h-6 w-6 p-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      ) : (
        <>
          {onViewChange && (
            <button
              type="button"
              onClick={() => onViewChange("settings")}
              title="settings"
              aria-label="settings"
              className="h-6 w-6 p-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => clearChat(chat.id)}
            disabled={chat.isStreaming || chat.messages.length === 0}
            title="clear chat"
            aria-label="clear chat"
            className="h-6 w-6 p-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-muted/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
