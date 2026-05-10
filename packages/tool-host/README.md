# tool-host

FastAPI sidecar that executes catalyst-llm-sdk tool calls server-side.
The browser-side SDK (`@catalyst/llm-sdk` `streamChat({ tools })` loop)
dispatches each call here, which then talks to whichever backend that
specific tool needs (SearXNG, headless browser, future MCP adapters)
without dragging the browser through CORS / running a headless
browser / holding API keys.

## Architecture

```
playground (browser)
    │ POST /v1/chat/completions  {tools: [...]}
    ▼
LiteLLM proxy
    │ → model
    │ ← model response with tool_calls[]
    ▼
playground (browser)         tool-host (this service)
    │ ToolRegistry.invoke ─▶ POST /v1/tools/web_search
    │                        │ → SearXNG /search?format=json
    │                        ▼
    │ ◀───── result ─────────┘
    │ (next iteration of streamChat tool-call loop)
    ▼
LiteLLM proxy → model → ...
```

## Tools

| Tool            | Status        | Backend                                  |
|-----------------|---------------|------------------------------------------|
| `web_search`    | ✓ implemented | SearXNG (`SEARXNG_URL` env)              |
| `browse_page`   | Pass 2        | Playwright (Chromium) — not in this image |

## Run

### Via docker-compose (recommended, alongside searxng)

```bash
# from repo root
docker compose up -d tool-host searxng
curl -s http://localhost:7077/healthz
curl -s -X POST http://localhost:7077/v1/tools/web_search \
  -H "Content-Type: application/json" \
  -d '{"query":"FLUX.1 Krea Dev release notes","n":5}'
```

### Standalone, dev mode

```bash
cd packages/tool-host
uv sync
SEARXNG_URL=http://localhost:8888 uv run tool-host
# then point the SDK at http://localhost:7077:
#   webSearchTool({ baseUrl: "http://localhost:7077" })
```

## Configuration

| Env var                  | Default                                | Purpose                                    |
|--------------------------|----------------------------------------|--------------------------------------------|
| `SEARXNG_URL`            | `http://searxng:8080`                  | Where to send SearXNG queries              |
| `SEARXNG_ENGINES`        | `google,bing,duckduckgo,brave,wikipedia,github` | Comma-separated SearXNG engine list |
| `TOOL_HOST_PORT`         | `7077`                                 | Bind port                                  |
| `TOOL_HOST_HOST`         | `0.0.0.0`                              | Bind address                               |
| `TOOL_HOST_API_KEY`      | unset                                  | Optional bearer token for `Authorization`  |
| `TOOL_HOST_HTTP_TIMEOUT` | `20`                                   | httpx timeout in seconds                   |

## Wiring into the SDK

```typescript
import {
  CatalystLLMClient,
  ToolRegistry,
  webSearchTool,
} from "@catalyst/llm-sdk";

const client = new CatalystLLMClient({ baseUrl: "http://litellm.talos00", apiKey: "..." });

const tools = new ToolRegistry();
tools.register(webSearchTool({ baseUrl: "http://localhost:7077" }));

for await (const chunk of client.streamChat({
  model: "claude-haiku-4-5-20251001",
  messages: [{ role: "user", content: "What's new in FLUX this week?" }],
  tools,
})) {
  process.stdout.write(chunk.delta);
}
```

The streamChat loop will: send the request with tool definitions →
detect `tool_calls` in the streamed response → invoke each call against
the registry → POST to this service → append the result as a `role:
"tool"` message → repeat until the model returns content without
tool_calls.

## Roadmap

Pass 2:
- `browse_page` via Playwright (Chromium) + readability-style extraction
- `read_file` against an opt-in workspace directory (sandboxed)
- MCP adapter — register tools defined in `config/mcp/mcp-config.json`
  by speaking the MCP protocol to those servers and translating each
  tool to OpenAI's `tools` schema
