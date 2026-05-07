import { ExternalLink } from "lucide-react";
import {
  CatalystLLMClient,
  ChatPanel,
  ChatTabs,
  ConnectionStatus,
  LLMProvider,
  useChatStore,
} from "@catalyst/llm-sdk";

const baseUrl =
  (import.meta.env.VITE_LITELLM_URL as string | undefined) ??
  "http://localhost:4000";
const apiKey = (import.meta.env.VITE_LITELLM_KEY as string | undefined) ?? "";

const client = new CatalystLLMClient({ baseUrl, apiKey });

function Header() {
  return (
    <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0 bg-card">
      <h1 className="text-lg font-bold tracking-wider">
        Catalyst LLM SDK · Playground
      </h1>
      <div className="flex items-center gap-4">
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

function Workspace() {
  const { chats, activeChat } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  return (
    <>
      <ChatTabs />
      <main className="flex-1 overflow-hidden">
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
  return (
    <LLMProvider client={client}>
      <div className="h-screen flex flex-col bg-background text-foreground">
        <Header />
        <Workspace />
      </div>
    </LLMProvider>
  );
}

export default App;
