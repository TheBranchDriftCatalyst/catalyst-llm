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

  // SP-PRO3: context window gauge — same /4-chars-per-token approximation
  // ChatHeader uses, plus pull ctxLimit from selectedModel metadata with
  // an 8k fallback for unknown models. Computed up here so both the dense
  // and standard branches could consume it later without divergence.
  const totalChars = chat.messages.reduce(
    (sum, m) => sum + (m.content?.length ?? 0),
    0,
  );
  const approxTokens = Math.round(totalChars / 4);
  const ctxLimit = selectedModel?.metadata?.max_input_tokens ?? 8192;
  const ctxRatio = Math.min(1, approxTokens / ctxLimit);
  const ctxFillColor =
    ctxRatio < 0.6
      ? "text-primary"
      : ctxRatio < 0.85
        ? "text-warn"
        : "text-alert";
  const approxK = (approxTokens / 1000).toFixed(approxTokens >= 10_000 ? 0 : 1);
  const ctxK = Math.round(ctxLimit / 1000);

  // SP-PRO8: parameter presets — clicking a chip atomically sets
  // temperature/top_p/max_tokens. "Active" preset is detected by
  // approximate match on all three fields so user-customized values
  // don't false-positive as a preset.
  const PARAM_PRESETS = [
    { id: "deterministic", temperature: 0.0, top_p: 1.0, max_tokens: 2048 },
    { id: "balanced", temperature: 0.7, top_p: 1.0, max_tokens: 2048 },
    { id: "creative", temperature: 1.1, top_p: 0.95, max_tokens: 4096 },
    { id: "brainstorm", temperature: 1.4, top_p: 0.95, max_tokens: 4096 },
  ] as const;
  const activePresetId = PARAM_PRESETS.find(
    (p) =>
      Math.abs((chat.params.temperature ?? 0.7) - p.temperature) < 0.01 &&
      Math.abs((chat.params.top_p ?? 1.0) - p.top_p) < 0.01 &&
      (chat.params.max_tokens ?? 2048) === p.max_tokens,
  )?.id;

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
          // SP1: ParameterControls renders `<div class="flex justify-between
          // text-sm"><Label>Temperature</Label><span>0.7</span></div>` but
          // the prior `[&_label]:text-[10px]` shrank only the label while
          // the sibling span kept text-sm — baselines drifted apart and
          // the value floated above the label. Pin both children to the
          // same micro-font + mono + tabular-nums and force the row to
          // items-center so the value sits on the label's baseline.
          "[&_label]:flex [&_label]:items-center [&_label]:font-mono [&_label]:text-[10px]",
          // Scope the row-alignment fix to ParameterControls' specific
          // `flex justify-between text-sm` row — `.text-sm` keeps us off
          // our own SP3 header (which is `text-[9px]` / `text-[8px]`).
          "[&_.flex.justify-between.text-sm]:items-center",
          "[&_.flex.justify-between.text-sm_span]:font-mono [&_.flex.justify-between.text-sm_span]:text-[10px] [&_.flex.justify-between.text-sm_span]:tabular-nums",
          // SP3: SystemPromptEditor renders an internal `<Label>System
          // Prompt</Label>` immediately followed by `<Textarea>`. We hide
          // that inner label (using :has(+textarea) to scope precisely)
          // and render our own header row above it with an autosave hint.
          "[&_label:has(+textarea)]:hidden",
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
        {/* SP-PRO3: ctx window gauge — 60px-wide hairline bar with
            a primary/warn/alert fill that scales with utilization.
            Sits above the model selector so the user sees the budget
            before they fiddle with the model. */}
        <div
          data-testid="settings-ctx-gauge"
          className="flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground tabular-nums"
        >
          <span>ctx</span>
          <div
            aria-hidden
            className="relative h-px w-[60px] bg-border/40 overflow-hidden"
          >
            <div
              className={cn(
                "absolute inset-y-0 left-0 bg-current",
                ctxFillColor,
              )}
              style={{ width: `${Math.round(ctxRatio * 100)}%` }}
            />
          </div>
          <span className="tabular-nums">
            {approxK}k / {ctxK}k
          </span>
        </div>
        <ModelSelector
          value={chat.model}
          onChange={(model) => setModel(chat.id, model)}
        />
        {/* SP3: SystemPromptEditor stores every keystroke through
            useChatStore → persists to localStorage. There was no UI
            signal of that. Render our own header row above it (the
            internal Label is hidden via the `:has(+textarea)` selector
            on the panel root) with a tracking-wide section heading +
            a dimmer "· auto-saved" sibling so users see the autosave
            contract without us having to fork SystemPromptEditor. */}
        <div
          data-testid="system-prompt-header"
          className="flex items-center justify-between mb-1"
        >
          <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
            system prompt
          </span>
          <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
            · auto-saved
          </span>
        </div>
        <SystemPromptEditor
          value={chat.systemPrompt}
          onChange={(prompt) => setSystemPrompt(chat.id, prompt)}
        />
        <ParameterControls
          params={chat.params}
          onChange={(params) => setParams(chat.id, params)}
          model={selectedModel}
        />
        {/* SP-PRO8: parameter presets — micro-row of chips below the
            sliders that atomically apply temperature/top_p/max_tokens
            in known-good combinations. Active chip is highlighted via
            primary-tinted bg/border so the user knows which preset
            (if any) currently maps to their slider state. */}
        <div
          data-testid="settings-param-presets"
          className="flex flex-wrap gap-1 pt-1"
        >
          {PARAM_PRESETS.map((preset) => {
            const isActive = preset.id === activePresetId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  setParams(chat.id, {
                    temperature: preset.temperature,
                    top_p: preset.top_p,
                    max_tokens: preset.max_tokens,
                  })
                }
                className={cn(
                  "text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-sm border transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary border-primary/50"
                    : "border-border/30 bg-muted/[0.10] hover:bg-primary/10 hover:text-primary hover:border-primary/40",
                )}
              >
                {preset.id}
              </button>
            );
          })}
        </div>
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

