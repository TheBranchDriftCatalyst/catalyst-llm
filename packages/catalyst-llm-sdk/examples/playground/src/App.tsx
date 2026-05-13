import { Suspense, lazy, useEffect } from "react";
import {
  CatalystAgentClient,
  CatalystLLMClient,
  ChatPanel,
  ChatTabs,
  CompareView,
  EnginePage,
  LLMProvider,
  PromptEditor,
  useChatStore,
  useCompareStore,
} from "@catalyst/llm-sdk";
// Dev-only — kept on a side import so a prod build that omits this single
// line ships zero unload code. Vite tree-shakes since `unloadModel` is
// only used inside the `import.meta.env.DEV` branch.
import { unloadModel, recordMetric, shortHash } from "@catalyst/llm-sdk/dev";
import { Header } from "./nav/Header.js";
import { useRoute } from "./nav/useRoute.js";

// StatsView is gated behind a lazy import + the import.meta.env.DEV
// flag so the DuckDB-WASM payload (~10 MB) only lands when a dev
// actually clicks the /stats tab — never in a production bundle.
const StatsView = import.meta.env.DEV
  ? lazy(() =>
      import("@catalyst/llm-sdk/dev").then((m) => ({ default: m.StatsView })),
    )
  : null;
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

// Tool dispatch lives entirely server-side now (catalyst-langgraph +
// tool-host). The available tool catalog is fetched at runtime via
// `useAvailableTools()` (→ /api/tools); nothing to construct here.
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
        {page === "engine" && (
          <main id="main-content" className="flex-1 overflow-hidden">
            <EnginePage />
          </main>
        )}
        {page === "stats" && import.meta.env.DEV && StatsView && (
          <main id="main-content" className="flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading DuckDB-WASM…
                </div>
              }
            >
              <StatsView />
            </Suspense>
          </main>
        )}
        {/* Background recorder — silently writes one row per completed
            chat / compare turn into the in-browser DuckDB. Dev-only. */}
        {import.meta.env.DEV && <MetricsRecorder />}
      </div>
    </LLMProvider>
  );
}

/**
 * Subscribes to chat/compare stores and writes a metrics row every
 * time a turn finishes. Lives at the App root so a single subscription
 * covers both surfaces; render-free, returns null.
 */
function MetricsRecorder() {
  const chats = useChatStore((s) => s.chats);
  const compareRuns = useCompareStore((s) => s.runs);

  // Track which turns we've already recorded so a re-render doesn't
  // double-write. Module-scoped Set keeps state outside React's
  // render cycle and survives StrictMode double-mount.
  useEffect(() => {
    for (const c of chats) {
      // We key on streamEndTime so a chat re-streamed after `Clear`
      // produces a fresh row even though chat_id and message count
      // are the same.
      if (c.isStreaming || !c.streamEndTime) continue;
      const turnId = `${c.id}:${c.streamEndTime}`;
      if (_recordedTurns.has(turnId)) continue;
      _recordedTurns.add(turnId);
      // Per-message meta is attached to the assistant turn that just
      // finished — fish it off the last message rather than from the
      // chat root (where there is no aggregate field).
      const lastMsg = c.messages[c.messages.length - 1];
      const lastMeta = lastMsg?.role === "assistant" ? lastMsg.meta : undefined;
      const usage = lastMeta?.usage ?? {};
      const ttft = c.firstTokenTime && c.streamStartTime
        ? c.firstTokenTime - c.streamStartTime
        : undefined;
      const duration = c.streamEndTime && c.streamStartTime
        ? c.streamEndTime - c.streamStartTime
        : undefined;
      const completion = usage.completion_tokens;
      const tokSec =
        completion && c.firstTokenTime && c.streamEndTime
          ? completion / ((c.streamEndTime - c.firstTokenTime) / 1000)
          : undefined;
      const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
      void recordMetric({
        ts: new Date(c.streamEndTime),
        chat_id: c.id,
        turn_id: turnId,
        source: "chat",
        model: c.model,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: completion,
        total_tokens: usage.total_tokens,
        ttft_ms: ttft,
        duration_ms: duration,
        tokens_per_sec: tokSec,
        finish_reason: lastMeta?.finish_reason ?? undefined,
        n_messages: c.messages.length,
        ctx_used: usage.prompt_tokens,
        system_prompt_hash: shortHash(c.systemPrompt),
        user_prompt_hash: shortHash(lastUser?.content),
      });
    }
  }, [chats]);

  useEffect(() => {
    for (const [modelId, run] of Object.entries(compareRuns)) {
      if (run.isStreaming || !run.streamEndTime) continue;
      const turnId = `compare:${modelId}:${run.streamEndTime}`;
      if (_recordedTurns.has(turnId)) continue;
      _recordedTurns.add(turnId);
      const usage = run.meta?.usage ?? {};
      const ttft = run.firstTokenTime && run.streamStartTime
        ? run.firstTokenTime - run.streamStartTime
        : undefined;
      const duration = run.streamEndTime && run.streamStartTime
        ? run.streamEndTime - run.streamStartTime
        : undefined;
      const completion = usage.completion_tokens;
      const tokSec =
        completion && run.firstTokenTime && run.streamEndTime
          ? completion / ((run.streamEndTime - run.firstTokenTime) / 1000)
          : undefined;
      void recordMetric({
        ts: new Date(run.streamEndTime),
        turn_id: turnId,
        source: "compare",
        model: modelId,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: completion,
        total_tokens: usage.total_tokens,
        ttft_ms: ttft,
        duration_ms: duration,
        tokens_per_sec: tokSec,
        finish_reason: run.error ? "error" : run.meta?.finish_reason ?? "stop",
        error: run.error,
      });
    }
  }, [compareRuns]);

  return null;
}

const _recordedTurns = new Set<string>();

export default App;
