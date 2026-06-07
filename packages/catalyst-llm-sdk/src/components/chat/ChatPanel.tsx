import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Card, CardContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/card";
import {
  Send,
  Square,
  Trash2,
  Image as ImageIcon,
  X,
  RotateCcw,
  Wrench,
  Check,
  ChevronDown,
  Settings,
} from "lucide-react";
import { useChatStore, type Chat } from "../../react/chat/index.js";
import { ChatMessage } from "./ChatMessage.js";
import { ModelSelector } from "../model-selector/ModelSelector.js";
import { ModelSelectorRich } from "../model-selector/ModelSelectorRich.js";
import { ModelMicroSwitcher } from "../model-selector/ModelMicroSwitcher.js";
import { ModelInfoCard } from "../model-selector/ModelInfoCard.js";
import { CostPins } from "../stats/CostPins.js";
import { ContextMeter } from "../stats/ContextMeter.js";
import { ParameterControls } from "../model-selector/ParameterControls.js";
import { SystemPromptEditor } from "../prompts/SystemPromptEditor.js";
import { ResponseViewer } from "../chat/ResponseViewer.js";
import {
  PromptPresets,
  SystemPromptPresets,
} from "../prompts/PromptPresets.js";
import { getPresetsForModel } from "../prompts/prompt-seeds.js";
import { useModels, useAvailableTools, type AvailableTool } from "../../react/hooks.js";
import { useFocusTrap } from "../shared/useFocusTrap.js";
import { cn } from "../shared/utils.js";

export interface ChatPanelProps {
  chat: Chat;
  /**
   * Controlled composer text (op-w76). When provided, the textarea is
   * fully controlled — useful for hosts that want to persist the
   * draft to localStorage / a session store / etc. across reloads or
   * tab switches. When omitted, ChatPanel manages its own internal
   * input state (the legacy behaviour). Pair with ``onDraftChange``.
   */
  draft?: string;
  /**
   * Notification for every composer-text change. Required when
   * ``draft`` is provided; ignored otherwise.
   */
  onDraftChange?: (next: string) => void;
  /**
   * Dense (rail-friendly) mode. Hides the left configuration sidebar
   * and moves model+params+system-prompt into a compact header strip
   * with an expandable settings panel. Use when the panel is mounted
   * in a narrow surface (~380px) like the operator chat rail. Default
   * false — preserves the full two-column layout for standalone pages.
   */
  dense?: boolean;
}

export function ChatPanel({ chat, draft, onDraftChange, dense = false }: ChatPanelProps) {
  // Controlled draft path: host owns the value (e.g., per-session
  // persistence). Uncontrolled fallback keeps a local input for
  // hosts that don't care about reload survival.
  const isControlled = draft !== undefined;
  const [internalInput, setInternalInput] = useState("");
  const input = isControlled ? (draft as string) : internalInput;
  const setInput = (next: string) => {
    if (isControlled) {
      onDraftChange?.(next);
    } else {
      setInternalInput(next);
    }
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    sendMessage,
    stopStreaming,
    clearChat,
    setModel,
    setSystemPrompt,
    setParams,
    resumeChat,
    setEnabledTools,
  } = useChatStore();
  const { tools: availableTools } = useAvailableTools();
  const { models } = useModels();
  const selectedModel = models.find((m) => m.id === chat.model);
  const [showVisionStub, setShowVisionStub] = useState(false);
  const visionDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(visionDialogRef, showVisionStub);

  // Escape closes the vision-stub modal — keyboard parity with the click-out
  // dismissal already wired below.
  useEffect(() => {
    if (!showVisionStub) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowVisionStub(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showVisionStub]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chat.messages, scrollToBottom]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || chat.isStreaming || !chat.model) return;
    setInput("");
    await sendMessage(chat.id, message);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // In dense mode the panel is a single column that flips between
  // CHAT and SETTINGS views — gear flips to settings, X flips back.
  // No more side-by-side rendering. Aimed at narrow-rail surfaces
  // where pixels are scarce.
  const [denseView, setDenseView] = useState<"chat" | "settings">("chat");
  // Show the settings view inline in dense mode by reusing the same
  // controls (ModelSelector, ParameterControls, etc.) the legacy
  // sidebar uses — just stacked vertically and tightened up.
  const showDenseSettings = dense && denseView === "settings";

  return (
    <div className="flex h-full">
      {/* Legacy two-column sidebar — only rendered in standard mode.
          Dense mode flips the entire panel between chat ↔ settings
          views instead of placing them side by side. */}
      {!dense && (
      <div
        className="w-80 border-r border-border p-4 space-y-6 overflow-y-auto shrink-0 bg-muted/10"
      >
        <ModelSelector
          value={chat.model}
          onChange={(model) => setModel(chat.id, model)}
        />
        <ModelSelectorRich
          value={chat.model}
          onChange={(model) => setModel(chat.id, model)}
        />
        {selectedModel && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Model details
            </div>
            <ModelInfoCard model={selectedModel} />
          </div>
        )}
        <div className="space-y-2">
          <SystemPromptEditor
            value={chat.systemPrompt}
            onChange={(prompt) => setSystemPrompt(chat.id, prompt)}
          />
          <SystemPromptPresets
            onApply={(p) => {
              if (p.systemPrompt) setSystemPrompt(chat.id, p.systemPrompt);
            }}
          />
        </div>
        <ParameterControls
          params={chat.params}
          onChange={(params) => setParams(chat.id, params)}
          model={selectedModel}
        />
        <div className="pt-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearChat(chat.id)}
            disabled={chat.isStreaming || chat.messages.length === 0}
            className="w-full"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Chat
          </Button>
        </div>
      </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {dense && (
          <>
            {/* Compact header strip: tiny model switcher + gear flip
                + clear. Gear flips the WHOLE panel to settings; X (in
                settings view) flips back. No side-by-side rendering
                so every pixel of width belongs to the active view. */}
            <div className="flex items-center gap-1 border-b border-border bg-card/30 px-2 py-1">
              <div className="flex-1 min-w-0">
                <ModelMicroSwitcher
                  value={chat.model}
                  onChange={(model) => setModel(chat.id, model)}
                />
              </div>
              {showDenseSettings ? (
                <button
                  type="button"
                  onClick={() => setDenseView("chat")}
                  title="back to chat"
                  aria-label="back to chat"
                  className="h-6 w-6 p-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setDenseView("settings")}
                    title="settings"
                    aria-label="settings"
                    className="h-6 w-6 p-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-muted/40 transition-colors"
                  >
                    <Settings className="h-3 w-3" />
                  </button>
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
            {showDenseSettings && (
              <div className="flex-1 overflow-y-auto p-2 space-y-3 bg-muted/10 font-mono">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                    model
                  </div>
                  <ModelSelector
                    value={chat.model}
                    onChange={(model) => setModel(chat.id, model)}
                  />
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                    system prompt
                  </div>
                  <SystemPromptEditor
                    value={chat.systemPrompt}
                    onChange={(prompt) => setSystemPrompt(chat.id, prompt)}
                  />
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                    parameters
                  </div>
                  <ParameterControls
                    params={chat.params}
                    onChange={(params) => setParams(chat.id, params)}
                    model={selectedModel}
                  />
                </div>
                {selectedModel && (
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                      details
                    </div>
                    <ModelInfoCard model={selectedModel} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {/* Chat surface (CostPins + ContextMeter + messages + composer).
            In dense settings view this entire block is hidden — the
            flip replaces it, doesn't overlay it. */}
        {!showDenseSettings && (
          <>
        {/* CostPins / tools / streaming pulse strip. In dense mode this
            moves to a tiny single-line bottom strip below the composer
            so the chat surface stays focused on messages. */}
        {!dense && (
          <div className="flex items-center justify-between gap-3 bg-card/30 px-4 py-2">
            <CostPins chat={chat} />
            <div className="flex items-center gap-3">
              {availableTools.length > 0 && (
                <ToolsToggle
                  tools={availableTools}
                  enabled={chat.enabledTools ?? []}
                  onChange={(names) => setEnabledTools(chat.id, names)}
                />
              )}
              {chat.isStreaming && (
                <span className="text-[10px] uppercase tracking-wider text-primary animate-pulse">
                  streaming…
                </span>
              )}
            </div>
          </div>
        )}
        {/* Context gauge under the stats chips — only in non-dense.
            Dense surfaces context as a tiny number in the bottom stat
            strip, not a full bar (every pixel matters in a rail). */}
        {!dense && (
          <ContextMeter
            chat={chat}
            model={selectedModel}
            variant="bar"
            className="border-b border-border bg-card/30"
          />
        )}
        <div className="flex-1 overflow-y-auto">
          {chat.messages.length === 0 ? (
            dense ? (
              // Dense empty state — single tracking-wide line, no big card.
              <div className="flex items-center justify-center h-full text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">
                {chat.model ? "send to begin" : "select model"}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {chat.model ? (
                  <Card interactive={false} className="max-w-md">
                    <CardContent className="pt-6 text-center">
                      <p className="text-lg font-medium mb-2">
                        Start a conversation
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Type a message below to begin chatting with {chat.model}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card interactive={false} className="max-w-md">
                    <CardContent className="pt-6 text-center">
                      <p className="text-lg font-medium mb-2">Select a model</p>
                      <p className="text-sm text-muted-foreground">
                        Choose a model from the sidebar to get started
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          ) : (
            <div className={dense ? "" : "divide-y divide-border"}>
              {chat.messages.map((message, idx) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isStreaming={
                    chat.isStreaming && idx === chat.messages.length - 1
                  }
                  dense={dense}
                  chat={chat}
                  messageIndex={idx}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {chat.interrupted && (
          <div
            role="alert"
            aria-live="polite"
            className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-yellow-600/30 bg-yellow-500/10 p-3 text-sm text-yellow-500"
          >
            <span>
              Last turn was interrupted (likely by a refresh). The partial
              response above is what survived.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resumeChat(chat.id)}
              className="shrink-0"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Resume
            </Button>
          </div>
        )}
        {chat.error && !chat.interrupted && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-4 mb-2 p-3 text-sm bg-destructive/10 border border-destructive/20 rounded-md text-destructive"
          >
            {chat.error}
          </div>
        )}

        {!dense && <ResponseViewer chat={chat} />}

        <form
          onSubmit={handleSubmit}
          className={cn(
            "border-t border-border bg-background",
            dense ? "p-2" : "p-4",
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
            {!dense && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowVisionStub(true)}
                disabled={!chat.model}
                title={
                  selectedModel?.metadata?.supports_vision
                    ? "Attach image (coming soon)"
                    : "Vision upload (coming soon — selected model also lacks vision support)"
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
                placeholder={
                  chat.model ? (dense ? "message · ⌘⏎ send" : "Type a message...") : "Select a model first"
                }
                disabled={!chat.model}
                rows={1}
                className={cn(
                  "resize-none",
                  dense
                    ? "min-h-[28px] max-h-[120px] py-1.5 px-2 text-[11px] font-mono"
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
                className={dense ? "h-7 w-7 p-0 shrink-0" : ""}
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
        {/* Dense bottom stat strip — tiny single-line summary with the
            cost pin row + context meter folded into one row. Only
            appears when the chat has activity (otherwise stays hidden
            so an empty rail looks clean). */}
        {dense && (chat.messages.length > 0 || chat.isStreaming) && (
          <div className="shrink-0 border-t border-border/60 bg-card/30 px-2 py-1 flex items-center gap-2 overflow-x-auto">
            <CostPins chat={chat} />
            {chat.isStreaming && (
              <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.22em] text-primary animate-pulse">
                ◇ streaming
              </span>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {showVisionStub && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vision-stub-title"
          onClick={() => setShowVisionStub(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <div
            ref={visionDialogRef}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-md border border-border bg-card p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setShowVisionStub(false)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              title="Close"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="mb-3 flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 id="vision-stub-title" className="text-base font-semibold">
                Vision upload
              </h2>
              <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                soon
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Attach images and PDFs to send to vision-capable models. The
              selected model{" "}
              <span className="font-mono">{chat.model || "(none)"}</span>{" "}
              {selectedModel?.metadata?.supports_vision
                ? "supports vision — once this lands, drop a file here to multipart-encode it into the next message."
                : "doesn't expose vision capability via /model/info; switch to a model with the vision badge first."}
            </p>
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => setShowVisionStub(false)}
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact popover that lets the user toggle which tools the model is
 * allowed to invoke on this chat. Reads the catalog from the agent
 * backend (`useAvailableTools()` → /api/tools); writes the per-chat
 * enabled set via `chatStore.setEnabledTools(chatId, names)`. The
 * button face shows the active count so the user can see at a glance
 * that tools are armed without opening the popover.
 */
function ToolsToggle({
  tools,
  enabled,
  onChange,
}: {
  tools: AvailableTool[];
  enabled: string[];
  onChange: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popoverRef, open);

  const list = tools;
  const enabledSet = new Set(enabled);

  function toggle(name: string) {
    const next = new Set(enabled);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  }

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const activeCount = enabled.length;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          activeCount > 0
            ? `Tools (${activeCount} active)`
            : "Tools — none enabled"
        }
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium",
          "transition-colors hover:border-primary/60 hover:bg-accent/40 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          activeCount > 0 && "border-primary/60",
        )}
      >
        <Wrench
          className={cn(
            "h-3 w-3",
            activeCount > 0 ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="uppercase tracking-wider text-muted-foreground">
          tools
        </span>
        {activeCount > 0 && (
          <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold text-primary">
            {activeCount}
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Tool selection"
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5">
            <Wrench className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              tools · {list.length} registered
            </span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {list.length === 0 && (
              <li className="px-3 py-3 text-center text-[10px] text-muted-foreground">
                No tools available. Verify the agent backend is reachable
                at <code>/api/tools</code>.
              </li>
            )}
            {list.map((t) => {
              const checked = enabledSet.has(t.name);
              return (
                <li key={t.name}>
                  <button
                    type="button"
                    onClick={() => toggle(t.name)}
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                      "hover:bg-accent/40 hover:text-foreground transition-colors",
                      checked && "bg-primary/10",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                      aria-hidden="true"
                    >
                      {checked && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-medium">
                        {t.name}
                      </span>
                      {t.description && (
                        <span className="block text-[10px] leading-snug text-muted-foreground">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

