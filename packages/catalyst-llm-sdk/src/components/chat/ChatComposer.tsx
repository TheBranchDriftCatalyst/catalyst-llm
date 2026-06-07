/**
 * ChatComposer — input textarea + send/stop buttons for a Chat.
 *
 * Extracted from ChatPanel so consumers can compose their own chat
 * layouts. Wraps the textarea, send/stop buttons, optional image-
 * upload trigger, optional prompt presets, and the keyboard-hint
 * footer. Supports a controlled-draft mode (host owns the value via
 * draft + onDraftChange) for hosts that persist composer text across
 * reloads / tab switches.
 *
 * Sending: by default routes through useChatStore.sendMessage so the
 * configured agent client takes over. Pass ``onSend`` to override
 * (e.g., the operator threads harness_id + use_tool_router fields).
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Send, Square, ImageIcon } from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { useChatStore, type Chat } from "../../react/chat/index.js";
import { useModels } from "../../react/hooks.js";
import { PromptPresets } from "../prompts/PromptPresets.js";
import { getPresetsForModel } from "../prompts/prompt-seeds.js";
import { cn } from "../shared/utils.js";

export interface ChatComposerProps {
  chat: Chat;
  /** Tight rail variant — single-line textarea, smaller send button,
   *  no helper text, no prompt presets, no image button. */
  dense?: boolean;
  /** Controlled composer text. When set, the textarea reads/writes
   *  through host state; pair with ``onDraftChange``. */
  draft?: string;
  /** Notification on every composer change — required when ``draft``
   *  is set, ignored otherwise. */
  onDraftChange?: (next: string) => void;
  /** Override send. Defaults to useChatStore.sendMessage. Use when the
   *  host needs to thread extra fields (harness_id, view_state, etc.). */
  onSend?: (chatId: string, content: string) => void | Promise<void>;
  /** Optional callback for the image upload affordance. When omitted,
   *  the image button is hidden (saves rail width). */
  onImageClick?: () => void;
  className?: string;
}

export function ChatComposer({
  chat,
  dense = false,
  draft,
  onDraftChange,
  onSend,
  onImageClick,
  className,
}: ChatComposerProps) {
  const isControlled = draft !== undefined;
  const [internalInput, setInternalInput] = useState("");
  const input = isControlled ? (draft as string) : internalInput;
  const setInput = (next: string) => {
    if (isControlled) onDraftChange?.(next);
    else setInternalInput(next);
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, stopStreaming, setSystemPrompt } = useChatStore();
  const { models } = useModels();
  const selectedModel = models.find((m) => m.id === chat.model);
  const supportsVision = selectedModel?.metadata?.supports_vision;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = dense ? 120 : 200;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }, [input, dense]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const message = input.trim();
    if (!message || chat.isStreaming || !chat.model) return;
    setInput("");
    if (onSend) await onSend(chat.id, message);
    else await sendMessage(chat.id, message);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "bg-background",
        dense
          ? "px-2 py-1.5"
          : "border-t border-border p-4",
        className,
      )}
    >
      {!dense &&
        (() => {
          const bundle = getPresetsForModel(chat.model);
          return (
            <PromptPresets
              className="mb-2"
              presets={bundle.presets}
              label={bundle.label}
              labelIcon={bundle.icon}
              onApply={(p) => {
                if (p.user) setInput(p.user);
                if (p.systemPrompt) setSystemPrompt(chat.id, p.systemPrompt);
                textareaRef.current?.focus();
              }}
            />
          );
        })()}
      <div className="flex items-end gap-2">
        {!dense && onImageClick && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onImageClick}
            disabled={!chat.model}
            title={
              supportsVision
                ? "Attach image"
                : "Vision upload (model lacks vision support)"
            }
            className="shrink-0"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="chat-composer-input"
            placeholder={
              chat.model
                ? dense
                  ? "> ask the operator… (⌘K for commands)"
                  : "Type a message..."
                : "Select a model first"
            }
            disabled={!chat.model}
            rows={1}
            className={cn(
              "resize-none",
              dense
                ? "min-h-[24px] max-h-[120px] py-1 px-2 text-[11px] font-mono border-transparent bg-muted/[0.10] focus-visible:ring-0 focus-visible:border-primary/30 rounded-sm"
                : "min-h-[44px] max-h-[200px] pr-12",
            )}
          />
        </div>
        {chat.isStreaming ? (
          <Button
            type="button"
            variant="destructive"
            size={dense ? "sm" : "icon"}
            onClick={() => stopStreaming(chat.id)}
            title="Stop generating"
            className={dense ? "h-7 w-7 p-0 shrink-0" : ""}
          >
            <Square className={dense ? "h-3 w-3" : "h-4 w-4"} />
          </Button>
        ) : (
          <Button
            type="submit"
            size={dense ? "sm" : "icon"}
            disabled={!input.trim() || !chat.model}
            title="Send message"
            data-testid="chat-send-button"
            // Explicit orange-tinted hover so the affordance reads in
            // dense mode; the catalyst-ui sm button is otherwise too
            // quiet. Disabled state stays clearly inert (opacity-50
            // via Button base + no hover tint applied) to meet
            // WCAG AA contrast on the Send icon.
            className={cn(
              "border border-transparent transition-colors",
              "hover:bg-primary/15 hover:border-primary/50",
              "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-transparent",
              dense && "h-7 w-7 p-0 shrink-0",
            )}
          >
            <Send className={dense ? "h-3 w-3" : "h-4 w-4"} />
          </Button>
        )}
      </div>
      {!dense && (
        <div className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </div>
      )}
    </form>
  );
}
