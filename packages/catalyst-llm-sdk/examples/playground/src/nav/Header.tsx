/**
 * Top-bar nav. Iterates the page registry to build the tab row, then
 * surfaces global cross-cutting affordances: "stop all streams"
 * (chat + compare), the model micro-switcher for the active chat,
 * LiteLLM external links, and the connection status indicator.
 *
 * Adding a new tab is a one-line registry edit — see pages/index.ts.
 */
import { ExternalLink } from "lucide-react";
import {
  ConnectionStatus,
  ModelMicroSwitcher,
  useChatStore,
  useCompareStore,
} from "@catalyst/llm-sdk";
import { PAGES } from "../pages/index.js";
import type { PageId, PageMeta } from "../pages/types.js";
import { PageTab } from "./PageTab.js";

const MAC_NODE_IP = "192.168.1.33";

export interface HeaderProps {
  page: PageId;
  setPage: (p: PageId) => void;
  /** LiteLLM proxy base URL — drives the external "LiteLLM UI" + "API
   * Docs" links. Passed through from App so the env-reading stays in
   * one place. */
  baseUrl: string;
}

export function Header({ page, setPage, baseUrl }: HeaderProps) {
  const { chats, activeChat, setModel } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  const chatStreaming = chats.some((c) => c.isStreaming);
  const compareStreaming = useCompareStore((s) =>
    Object.values(s.runs).some((r) => r.isStreaming),
  );
  const stopAllChats = useChatStore((s) => s.stopStreaming);
  const stopAllCompare = useCompareStore((s) => s.stopAll);
  return (
    <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0 bg-card">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-wider">
          Catalyst LLM SDK · Playground
        </h1>
        <nav className="flex items-center gap-1 rounded-md border border-border bg-muted/20 p-0.5">
          {PAGES.map((meta) => (
            <RegistryPageTab
              key={meta.id}
              meta={meta}
              active={page === meta.id}
              onClick={() => setPage(meta.id)}
            />
          ))}
        </nav>
        {(chatStreaming || compareStreaming) && (
          <button
            type="button"
            onClick={() => {
              if (chatStreaming) {
                for (const c of chats) if (c.isStreaming) stopAllChats(c.id);
              }
              if (compareStreaming) stopAllCompare();
            }}
            title="Abort every in-flight stream across both tabs (kills any orphans)"
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-destructive hover:border-destructive hover:bg-destructive/20"
          >
            stop all
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span
          title="Mac inference node (Ollama + vLLM-MLX) — proxied via the LiteLLM ingress"
          className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground"
        >
          <span className="text-primary">mac</span>
          <span className="opacity-60">{MAC_NODE_IP}</span>
        </span>
        {page === "chat" && current && (
          <ModelMicroSwitcher
            value={current.model}
            onChange={(m) => setModel(current.id, m)}
          />
        )}
        <nav className="flex items-center gap-3 text-sm">
          <a
            href={`${baseUrl}/ui`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>LiteLLM UI</span>
            <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href={`${baseUrl}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>API Docs</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </nav>
        <div className="h-4 w-px bg-border" />
        <ConnectionStatus />
      </div>
    </header>
  );
}

/** Thin adapter that calls the page's optional streaming-indicator
 * hook (if it has one) and threads the result into <PageTab>. Lives
 * here rather than inside PageTab so PageTab stays a dumb leaf — any
 * page can opt into a pulse dot by declaring useStreamingIndicator. */
function RegistryPageTab({
  meta,
  active,
  onClick,
}: {
  meta: PageMeta;
  active: boolean;
  onClick: () => void;
}) {
  // Hooks must be called unconditionally — if the page omits the
  // selector, we fall back to a no-op hook that always returns false.
  const streaming = (meta.useStreamingIndicator ?? noStreaming)();
  return (
    <PageTab
      active={active}
      onClick={onClick}
      icon={meta.icon}
      label={meta.label}
      streaming={streaming}
    />
  );
}

const noStreaming = (): boolean => false;
