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
    return (
      <div
        className={cn(
          "flex-1 overflow-y-auto p-2 space-y-3 bg-muted/10 font-mono",
          className,
        )}
      >
        <DenseSection label="model">
          <ModelSelector
            value={chat.model}
            onChange={(model) => setModel(chat.id, model)}
          />
        </DenseSection>
        <DenseSection label="system prompt">
          <SystemPromptEditor
            value={chat.systemPrompt}
            onChange={(prompt) => setSystemPrompt(chat.id, prompt)}
          />
        </DenseSection>
        <DenseSection label="parameters">
          <ParameterControls
            params={chat.params}
            onChange={(params) => setParams(chat.id, params)}
            model={selectedModel}
          />
        </DenseSection>
        {selectedModel && (
          <DenseSection label="details">
            <ModelInfoCard model={selectedModel} />
          </DenseSection>
        )}
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

function DenseSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
