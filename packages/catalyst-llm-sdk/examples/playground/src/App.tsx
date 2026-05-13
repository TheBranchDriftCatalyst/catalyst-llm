import { CatalystAgentClient, CatalystLLMClient, LLMProvider } from "@catalyst/llm-sdk";
import { Header } from "./nav/Header.js";
import { useRoute } from "./nav/useRoute.js";
import { pageById } from "./pages/index.js";
import { MetricsRecorder } from "./metrics/MetricsRecorder.js";

const baseUrl =
  (import.meta.env.VITE_LITELLM_URL as string | undefined) ??
  "http://litellm.talos00";
const apiKey = (import.meta.env.VITE_LITELLM_KEY as string | undefined) ?? "";

const client = new CatalystLLMClient({ baseUrl, apiKey });

// catalyst-langgraph backend — owns the agent loop. Tilt injects
// VITE_AGENT_URL=http://localhost:7078 in dev (the local k3d port-
// forward); fall back to that default for naked `vite dev` runs.
const agentBaseUrl =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ??
  "http://localhost:7078";
const agentClient = new CatalystAgentClient({ baseUrl: agentBaseUrl });

function App() {
  const [page, setPage] = useRoute();
  const meta = pageById(page);
  const PageComponent = meta?.component;
  return (
    <LLMProvider client={client} agentClient={agentClient}>
      <div className="h-screen flex flex-col bg-background text-foreground">
        {/* Skip-to-main affordance — visually hidden but reachable by tab. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <Header page={page} setPage={setPage} baseUrl={baseUrl} />
        {PageComponent && <PageComponent onNavigate={setPage} />}
        {/* Background recorder — silently writes one row per completed
            chat / compare turn into the in-browser DuckDB. Dev-only. */}
        {import.meta.env.DEV && <MetricsRecorder />}
      </div>
    </LLMProvider>
  );
}

export default App;
