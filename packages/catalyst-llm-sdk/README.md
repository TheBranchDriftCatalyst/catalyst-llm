# @catalyst/llm-sdk

Unified LLM access SDK for the Catalyst workspace. Routes all LLM calls through the LiteLLM proxy with one client per language; mirrors the Python `catalyst-litellm-client` API.

Three coordinated layers in one package:

- **`@catalyst/llm-sdk/client`** — runtime-agnostic transport. `CatalystLLMClient` with `verifyConnection`, `getModels`, `getModelsWithRouting`, `createChat`, `streamChat` (`AsyncIterable<ChatChunk>`), `embed`. Zero React, no DOM.
- **`@catalyst/llm-sdk/react`** — `<LLMProvider>` Context plus hooks (`useLLM`, `useModels`, `useChat`, `useStreamingChat`, `useEmbed`, `useChatStore`).
- **`@catalyst/llm-sdk/components`** — drop-in UI: `ChatPanel`, `ChatTabs`, `ChatMessage`, `ModelSelector`, `ParameterControls`, `SystemPromptEditor`, `ResponseViewer`, `ConnectionStatus`. Consume the Provider via hooks; depend on `@thebranchdriftcatalyst/catalyst-ui` for primitives.

## Auth (interim)

Reads in this order: explicit constructor arg → `LITE_LLM_KEY` → `LITELLM_API_KEY` → `VITE_LITELLM_KEY` → `NEXT_PUBLIC_LITE_LLM_KEY`. For the base URL: `LITELLM_BASE_URL` → `VITE_LITELLM_URL` → `NEXT_PUBLIC_LITELLM_BASE_URL`. `envAliases` lets apps map their own var names without renaming `.env`.

Browser bundles will inline the key — acceptable for internal/homelab use; switch to a server proxy mount before any public-internet UI.

## Quick start

```tsx
import { LLMProvider, ChatPanel, ChatTabs, useChatStore } from "@catalyst/llm-sdk";

function App() {
  const { chats, activeChat } = useChatStore();
  const current = chats.find((c) => c.id === activeChat);
  return (
    <LLMProvider config={{ baseUrl: "http://litellm.talos00", apiKey: "sk-…" }}>
      <ChatTabs />
      {current && <ChatPanel chat={current} />}
    </LLMProvider>
  );
}
```

Node-only client usage:

```ts
import { CatalystLLMClient } from "@catalyst/llm-sdk/client";

const client = new CatalystLLMClient();
for await (const chunk of client.streamChat({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "hi" }],
})) {
  if (chunk.done) break;
  process.stdout.write(chunk.delta);
}
```
