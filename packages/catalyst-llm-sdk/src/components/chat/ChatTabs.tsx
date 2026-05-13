import { Tabs, TabsList, TabsTrigger } from "@thebranchdriftcatalyst/catalyst-ui/ui/tabs";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Plus, X, Columns3 } from "lucide-react";
import { useChatStore } from "../../react/chat/index.js";
import { useCompareStore } from "../../react/useCompare.js";
import { cn } from "../utils.js";

export interface ChatTabsProps {
  /**
   * If provided, an "Export → Compare" button is rendered in the tab strip.
   * Clicking it copies the active chat's last user prompt + system prompt
   * into the compare store, sets the model selection to the union of all
   * open chat tabs, and then invokes this callback so the host can route
   * to the compare view.
   */
  onExportToCompare?: () => void;
}

export function ChatTabs({ onExportToCompare }: ChatTabsProps = {}) {
  const { chats, activeChat, addChat, removeChat, setActiveChat } =
    useChatStore();
  const setSelectedIds = useCompareStore((s) => s.setSelectedIds);
  const setComparePrompt = useCompareStore((s) => s.setPrompt);
  const setCompareSystem = useCompareStore((s) => s.setSystemPrompt);

  const active = chats.find((c) => c.id === activeChat);
  // Most recent user-authored turn drives the export — that's the prompt the
  // user most likely wants to compare across models. Falls back to "" so the
  // button still works as a "preselect models, edit prompt" hand-off.
  const lastUserPrompt =
    active?.messages.filter((m) => m.role === "user").slice(-1)[0]?.content ??
    "";
  const tabModels = Array.from(
    new Set(chats.map((c) => c.model).filter(Boolean) as string[]),
  );
  const canExport = onExportToCompare && tabModels.length > 0;

  function handleExport() {
    if (!onExportToCompare) return;
    setSelectedIds(tabModels);
    setComparePrompt(lastUserPrompt);
    if (active?.systemPrompt) setCompareSystem(active.systemPrompt);
    onExportToCompare();
  }

  return (
    <div className="border-b border-border bg-muted/20">
      <Tabs value={activeChat} onValueChange={setActiveChat}>
        <div className="flex items-center px-2 py-1">
          <TabsList className="h-auto bg-transparent p-0 gap-1">
            {chats.map((chat) => (
              <TabsTrigger
                key={chat.id}
                value={chat.id}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-1.5 text-sm rounded-md",
                  "border border-transparent",
                  "data-[state=active]:bg-background data-[state=active]:border-border",
                  "data-[state=active]:shadow-sm",
                  "hover:bg-muted/50 transition-colors",
                  "max-w-[180px]",
                )}
              >
                <span className="truncate">{chat.model || chat.name}</span>
                {chat.isStreaming && (
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                )}
                {chats.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChat(chat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 transition-opacity shrink-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Close chat"
                    aria-label={`Close chat: ${chat.model || chat.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => addChat()}
            className="ml-1 shrink-0"
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>

          {onExportToCompare && (
            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport}
              title={
                canExport
                  ? `Open Compare with ${tabModels.length} model${tabModels.length === 1 ? "" : "s"} from these tabs and the last prompt prefilled`
                  : "Export → Compare (no models in tabs yet)"
              }
              aria-label="Export to Compare with this chat's models and last prompt"
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/40 px-2 py-1 text-[11px] font-medium",
                "hover:border-primary/60 hover:bg-accent/40 hover:text-foreground transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card/40",
              )}
            >
              <Columns3 className="h-3 w-3 text-primary" aria-hidden="true" />
              <span className="uppercase tracking-wider text-muted-foreground">
                → compare
              </span>
              {tabModels.length > 0 && (
                <span className="rounded-sm bg-primary/15 px-1 text-[9px] font-bold text-primary">
                  {tabModels.length}
                </span>
              )}
            </button>
          )}
        </div>
      </Tabs>
    </div>
  );
}
