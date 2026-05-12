export interface LLMConfigInit {
  baseUrl?: string;
  apiKey?: string;
  envAliases?: { baseUrl?: string[]; apiKey?: string[] };
  fetch?: typeof fetch;
}

// Deployed LiteLLM proxy is the canonical default. Stays in sync with
// packages/catalyst-llm-sdk/examples/playground/.env.example. Override
// with VITE_LITELLM_URL / LITELLM_URL when developing against a local
// proxy.
const DEFAULT_BASE_URL = "http://litellm.talos00";
const DEFAULT_API_KEY = "";

const DEFAULT_BASE_URL_ENV = [
  "LITELLM_BASE_URL",
  "VITE_LITELLM_URL",
  "NEXT_PUBLIC_LITELLM_BASE_URL",
];

// LITELLM_API_KEY is canonical. VITE_/NEXT_PUBLIC_ variants are framework
// requirements (Vite + Next only expose env vars with those prefixes to
// browser bundles); app code should set them = LITELLM_API_KEY's value.
const DEFAULT_API_KEY_ENV = [
  "LITELLM_API_KEY",
  "VITE_LITELLM_KEY",
  "NEXT_PUBLIC_LITELLM_API_KEY",
];

function readNodeEnv(names: string[]): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

export class LLMConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;

  constructor(init: LLMConfigInit = {}) {
    const baseUrlEnv = [...(init.envAliases?.baseUrl ?? []), ...DEFAULT_BASE_URL_ENV];
    const apiKeyEnv = [...(init.envAliases?.apiKey ?? []), ...DEFAULT_API_KEY_ENV];

    this.baseUrl =
      init.baseUrl ?? readNodeEnv(baseUrlEnv) ?? DEFAULT_BASE_URL;
    this.apiKey =
      init.apiKey ?? readNodeEnv(apiKeyEnv) ?? DEFAULT_API_KEY;

    if (!init.fetch && typeof fetch === "undefined") {
      throw new Error(
        "@catalyst/llm-sdk: no fetch implementation found. Provide one via config.fetch or use a runtime that ships fetch (Node 18+, Bun, browsers).",
      );
    }
    // Bind global fetch so it isn't invoked as a method on `this.config` (browsers throw "Illegal invocation").
    this.fetchImpl = init.fetch ?? fetch.bind(globalThis);
  }

  get isRemote(): boolean {
    return !this.baseUrl.includes("localhost") && !this.baseUrl.includes("127.0.0.1");
  }

  get authHeader(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  toString(): string {
    return `LLMConfig(baseUrl=${this.baseUrl}, apiKey=${this.apiKey ? "***" : "(none)"})`;
  }
}
