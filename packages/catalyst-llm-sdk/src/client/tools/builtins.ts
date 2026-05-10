/**
 * Built-in tool definitions wired to the catalyst tool-host (a small
 * FastAPI sidecar in packages/tool-host that owns the real side
 * effects so the browser doesn't have to deal with CORS or running
 * Playwright).
 *
 * Each builtin is a *factory* that takes a base URL (the tool-host's
 * address) and returns a ToolDefinition. Hosts pick what they want
 * to expose:
 *
 *     const tools = new ToolRegistry();
 *     tools.register(webSearchTool({ baseUrl: "http://tool-host:7000" }));
 *     tools.register(browsePageTool({ baseUrl: "..." }));
 *
 * The split keeps the bundle slim — a host that only wants
 * web_search doesn't pull in playwright args.
 */
import type { ToolDefinition } from "./types.js";

export interface ToolHostConfig {
  /** Base URL of the catalyst tool-host service (no trailing slash). */
  baseUrl: string;
  /** Optional bearer token if the tool-host is behind auth. */
  apiKey?: string;
  /** Override the global fetch impl (tests, Node). */
  fetchImpl?: typeof fetch;
}

async function callToolHost(
  cfg: ToolHostConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetchImpl = cfg.fetchImpl ?? fetch.bind(globalThis);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  const resp = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`tool-host ${path} failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── web_search ───────────────────────────────────────────────────────

export interface WebSearchArgs {
  query: string;
  /** Max results; defaults to 8 server-side. */
  n?: number;
  /** Optional time range filter ("day", "week", "month", "year"). */
  time_range?: "day" | "week" | "month" | "year";
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Engine that surfaced the result — useful for diversity weighting. */
  engine?: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
}

/**
 * Web search via SearXNG (proxied through the catalyst tool-host so
 * the browser can call it without CORS gymnastics). Returns up to N
 * URL+title+snippet results — the model can follow up with
 * browse_page to fetch the actual content.
 */
export function webSearchTool(cfg: ToolHostConfig): ToolDefinition<WebSearchArgs, WebSearchResponse> {
  return {
    name: "web_search",
    description:
      "Search the web (SearXNG-aggregated). Returns the top results as title/url/snippet. " +
      "Use when the user asks for recent information, current events, or facts you're not sure about. " +
      "Pair with browse_page when you need the full content of a result.",
    category: "web",
    transport: "remote",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "The search query — short and specific works best (5–10 words).",
        },
        n: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 8,
          description: "How many results to return.",
        },
        time_range: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Optional recency filter.",
        },
      },
      required: ["query"],
    },
    handler: async (args, ctx) =>
      (await callToolHost(
        cfg,
        "/v1/tools/web_search",
        args,
        ctx.signal,
      )) as WebSearchResponse,
  };
}

// ─── browse_page (scaffolded — Playwright impl lands in tool-host next) ──

export interface BrowsePageArgs {
  url: string;
  /** When true, returns rendered HTML; when false (default), returns extracted text only. */
  raw?: boolean;
  /** Maximum characters of content to return. Default 8000. */
  max_chars?: number;
}

export interface BrowsePageResponse {
  url: string;
  title: string;
  content: string;
  /** Optional set of resolved sub-links (helpful for the model to decide where to drill). */
  links?: { href: string; text: string }[];
}

/**
 * Fetch and render a web page through the tool-host's headless
 * browser. The tool-host handles JS-heavy pages via Playwright so the
 * model gets the same view a human would.
 */
export function browsePageTool(cfg: ToolHostConfig): ToolDefinition<BrowsePageArgs, BrowsePageResponse> {
  return {
    name: "browse_page",
    description:
      "Fetch a web page through a headless browser and return its title + main content. " +
      "Use after web_search when you need the actual content of a result. " +
      "Limited to 8000 chars by default — the model should ask for more or a different page if truncated.",
    category: "web",
    transport: "remote",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The full https:// URL to fetch.",
        },
        raw: {
          type: "boolean",
          default: false,
          description: "If true, return rendered HTML; otherwise return readability-extracted plain text.",
        },
        max_chars: {
          type: "integer",
          minimum: 500,
          maximum: 32000,
          default: 8000,
          description: "Truncate the content to this many characters.",
        },
      },
      required: ["url"],
    },
    handler: async (args, ctx) =>
      (await callToolHost(
        cfg,
        "/v1/tools/browse_page",
        args,
        ctx.signal,
      )) as BrowsePageResponse,
  };
}
