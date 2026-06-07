/**
 * ChatSettingsPanel — model + prompt + parameters settings for a Chat.
 *
 * Extracted from ChatPanel's sidebar / dense settings flip so consumers
 * can mount it as a popover, drawer, or full-page panel. Reads/writes
 * via useChatStore actions. Two layout variants:
 *   - standard:  generous spacing (matches ChatPanel sidebar)
 *   - dense:     tight tracking-wide labels, mono, no extra chrome
 */
import { useChatStore, type Chat } from "../../react/chat/index.js";
import { useModels } from "../../react/hooks.js";
import { ModelSelector } from "../model-selector/ModelSelector.js";
import { ModelSelectorRich } from "../model-selector/ModelSelectorRich.js";
import { ModelInfoCard } from "../model-selector/ModelInfoCard.js";
import { SystemPromptEditor } from "../prompts/SystemPromptEditor.js";
import { SystemPromptPresets } from "../prompts/PromptPresets.js";
import { ParameterControls } from "../model-selector/ParameterControls.js";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "../shared/utils.js";

export interface ChatSettingsPanelProps {
  chat: Chat;
  /** Dense (tight mono labels) vs standard (full sidebar). */
  dense?: boolean;
  /** Hide the "Clear Chat" footer button (host renders its own). */
  hideClearButton?: boolean;
  className?: string;
}

export function ChatSettingsPanel({
  chat,
  dense = false,
  hideClearButton = false,
  className,
}: ChatSettingsPanelProps) {
  const {
    setModel,
    setSystemPrompt,
    setParams,
    clearChat,
  } = useChatStore();
  const { models } = useModels();
  const selectedModel = models.find((m) => m.id === chat.model);

  if (dense) {
    // Drop the wrapper DenseSection labels — the SDK inner components
    // already render their own headers (Model, System Prompt,
    // Parameters). Stacking ours on top produced duplicate noise
    // ("MODEL" + "Model" etc). Descendant selectors (Tailwind v4) dim
    // ALL inner control borders + backgrounds in one place so we
    // don't have to fork every shadcn primitive.
    //
    // op-rxq settings flip CRITICALS:
    //   S1: textarea chrome — hairline border + inset bg + tighter focus
    //   S2: slider thumb visibility + inactive track lift + ≥20px hit area
    //   S3: micro-header "▸ SETTINGS" so the panel announces its mode
    //   S4: drop the duplicate ModelInfoCard (selector already shows it)
    //   S5: dead-code fall-through — card is gone, so badge mismatch is gone
    return (
      <div
        data-testid="chat-settings-panel-dense"
        className={cn(
          "flex-1 overflow-y-auto p-2 space-y-3 bg-background font-mono",
          // Borders across the board: trigger buttons, comboboxes,
          // textareas, model-info cards — drop opacity hard.
          // S1: textarea gets explicit chrome — hairline border, inset
          // muted bg, tight rounding, and a focused border state that
          // doesn't add a thick ring (which collides with our dense mono
          // grid). focus:ring-0 wins over shadcn's default focus-visible ring.
          "[&_textarea]:border [&_textarea]:border-border/15 [&_textarea]:bg-muted/[0.08] [&_textarea]:rounded-sm",
          "[&_textarea]:focus:border-primary/40 [&_textarea]:focus:ring-0",
          "[&_button[role=combobox]]:border-border/20 [&_button[role=combobox]]:bg-muted/[0.08]",
          "[&_[role=dialog]]:border-border/20",
          // ModelInfoCard, container divs with rounded-md border
          "[&_.rounded-md.border]:border-border/15 [&_.rounded-md.border]:bg-muted/[0.05]",
          // Tighten internal label sizes so they aren't huge sans-serif
          "[&_label]:text-[10px] [&_label]:font-mono [&_label]:text-muted-foreground",
          // S2: lift Radix slider's inactive (horizontal root) track so
          // it's actually visible against the muted panel bg. Then give
          // the thumb a hard primary fill, square-ish rounding to match
          // the rest of the dense grid, and a halo border that matches
          // the panel bg so it reads as a chip floating over the track.
          "[&_[data-orientation=horizontal]]:bg-border/40",
          "[&_[role=slider]]:bg-primary [&_[role=slider]]:border [&_[role=slider]]:border-background",
          "[&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:rounded-sm",
          // ≥20px touch target: invisible ::after expand-region around the
          // thumb (8px on every side → ~28px hit box). Pointer-events
          // inherit through Radix's thumb element.
          "[&_[role=slider]]:relative [&_[role=slider]]:after:absolute [&_[role=slider]]:after:inset-[-8px] [&_[role=slider]]:after:content-['']",
          className,
        )}
      >
        {/* S3: tracking-wide micro-header — gives the flip view an
            unambiguous "you are in SETTINGS" anchor that the ChatHeader
            host can't render (since extras is host-controlled). */}
        <div
          data-testid="settings-micro-header"
          className="text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground"
        >
          ▸ SETTINGS
        </div>
        <ModelSelector
          value={chat.model}
          onChange={(model) => setModel(chat.id, model)}
        />
        <SystemPromptEditor
          value={chat.systemPrompt}
          onChange={(prompt) => setSystemPrompt(chat.id, prompt)}
        />
        <ParameterControls
          params={chat.params}
          onChange={(params) => setParams(chat.id, params)}
          model={selectedModel}
        />
        {/* S4/S5: ModelInfoCard removed — duplicated the selector's
            model id + endpoint and shipped its own "Local" badge in a
            non-matching orange. The selector trigger already surfaces
            both, so the card is pure redundancy in dense mode.
            {selectedModel && <ModelInfoCard model={selectedModel} />} */}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-80 border-r border-border p-4 space-y-6 overflow-y-auto shrink-0 bg-muted/10",
        className,
      )}
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
      {!hideClearButton && (
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
      )}
    </div>
  );
}

