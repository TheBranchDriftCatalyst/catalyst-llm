/**
 * Top-bar nav. Shows the page-tab row, a global "stop all streams"
 * button when anything is in flight, the model micro-switcher for
 * the currently-active chat, LiteLLM external links, and the
 * connection status indicator.
 */
import { Columns3, Cpu, Database, ExternalLink, MessageSquare, Wand2 } from "lucide-react";
import {
  ConnectionStatus,
  ModelMicroSwitcher,
  useChatStore,
  useCompareStore,
} from "@catalyst/llm-sdk";
import { PageTab } from "./PageTab.js";
import type { Page } from "./useRoute.js";

const MAC_NODE_IP = "192.168.1.33";

export interface HeaderProps {
  page: Page;
  setPage: (p: Page) => void;
  /** LiteLLM proxy base URL — drives the external "LiteLLM UI" + "API
   * Docs" links. Passed through from App so the env-reading stays in
   * one place. */
  baseUrl: string;
}

export function Header({ page, setPage, baseUrl }: HeaderProps) {
  const { chats, activeChat, setModel } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  // Cross-tab streaming indicators — even when the user is on the Chat tab,
  // they can see at a glance that a Compare run is still in flight (and vice
  // versa). The runs themselves live in their respective Zustand stores and
  // continue updating across navigations.
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
          <PageTab
            active={page === "chat"}
            onClick={() => setPage("chat")}
            icon={MessageSquare}
            label="Chat"
            streaming={chatStreaming}
          />
          <PageTab
            active={page === "compare"}
            onClick={() => setPage("compare")}
            icon={Columns3}
            label="Compare"
            streaming={compareStreaming}
          />
          <PageTab
            active={page === "prompts"}
            onClick={() => setPage("prompts")}
            icon={Wand2}
            label="Prompts"
          />
          <PageTab
            active={page === "engine"}
            onClick={() => setPage("engine")}
            icon={Cpu}
            label="Engine"
          />
          {/* /stats is dev-only — prod builds drop the tab entirely
              along with the entire DuckDB-WASM payload. */}
          {import.meta.env.DEV && (
            <PageTab
              active={page === "stats"}
              onClick={() => setPage("stats")}
              icon={Database}
              label="Stats"
            />
          )}
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
