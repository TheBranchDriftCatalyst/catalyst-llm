import { useEffect, useState } from "react";
import { ExternalLink, MessageSquare, Columns3, Wand2 } from "lucide-react";
import {
  CatalystLLMClient,
  ChatPanel,
  ChatTabs,
  CompareView,
  ConnectionStatus,
  LLMProvider,
  ModelMicroSwitcher,
  PromptEditor,
  useChatStore,
  useCompareStore,
} from "@catalyst/llm-sdk";
// Dev-only — kept on a side import so a prod build that omits this single
// line ships zero unload code. Vite tree-shakes since `unloadModel` is
// only used inside the `import.meta.env.DEV` branch.
import { unloadModel } from "@catalyst/llm-sdk/dev";

const MAC_NODE_IP = "192.168.1.33";

const baseUrl =
  (import.meta.env.VITE_LITELLM_URL as string | undefined) ??
  "http://localhost:4000";
const apiKey = (import.meta.env.VITE_LITELLM_KEY as string | undefined) ?? "";

const client = new CatalystLLMClient({ baseUrl, apiKey });

type Page = "chat" | "compare" | "prompts";

const PATH_TO_PAGE: Record<string, Page> = {
  "/": "chat",
  "/chat": "chat",
  "/compare": "compare",
  "/prompts": "prompts",
};

function pageFromPath(path: string): Page {
  return PATH_TO_PAGE[path] ?? "chat";
}

function pathFromPage(page: Page): string {
  if (page === "compare") return "/compare";
  if (page === "prompts") return "/prompts";
  return "/chat";
}

/**
 * Tiny pushState router — two routes, zero deps. Listens for back/forward
 * via popstate and reflects tab switches into the URL bar so links and
 * refreshes are deep-linkable.
 */
function useRoute(): [Page, (p: Page) => void] {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Normalize "/" → "/chat" once on mount so future refreshes deep-link cleanly.
  useEffect(() => {
    if (path === "/") {
      const url = "/chat";
      window.history.replaceState({}, "", url);
      setPath(url);
    }
  }, [path]);

  const navigate = (p: Page) => {
    const url = pathFromPage(p);
    if (window.location.pathname !== url) {
      window.history.pushState({}, "", url);
      setPath(url);
    }
  };

  return [pageFromPath(path), navigate];
}

function Header({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
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

function PageTab({
  active,
  onClick,
  icon: Icon,
  label,
  streaming,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  streaming?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      {streaming && (
        <span
          aria-label={`Stream in flight on ${label} tab`}
          title="Stream in flight on this tab"
          className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
        />
      )}
    </button>
  );
}

function ChatWorkspace({ goCompare }: { goCompare: () => void }) {
  const { chats, activeChat } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  return (
    <>
      <ChatTabs onExportToCompare={goCompare} />
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

function App() {
  const [page, setPage] = useRoute();
  return (
    <LLMProvider client={client}>
      <div className="h-screen flex flex-col bg-background text-foreground">
        {/* Skip-to-main affordance — visually hidden but reachable by tab. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <Header page={page} setPage={setPage} />
        {page === "chat" && (
          <ChatWorkspace goCompare={() => setPage("compare")} />
        )}
        {page === "compare" && (
          <main id="main-content" className="flex-1 overflow-hidden">
            <CompareView
              onTurnComplete={
                import.meta.env.DEV
                  ? (modelId) => unloadModel(client, modelId)
                  : undefined
              }
            />
          </main>
        )}
        {page === "prompts" && (
          <main id="main-content" className="flex-1 overflow-hidden">
            <PromptEditor />
          </main>
        )}
      </div>
    </LLMProvider>
  );
}

export default App;
