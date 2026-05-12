import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LLMConfig } from "../src/client/index.js";

describe("LLMConfig", () => {
  const ENV_VARS = [
    "LITELLM_BASE_URL",
    "LITELLM_API_KEY",
    "VITE_LITELLM_URL",
    "VITE_LITELLM_KEY",
    "AI_BASE_URL",
    "AI_API_KEY",
  ];
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("uses defaults when nothing is set", () => {
    const c = new LLMConfig();
    // Default points at the deployed LiteLLM proxy — see config.ts.
    expect(c.baseUrl).toBe("http://litellm.talos00");
    expect(c.apiKey).toBe("");
  });

  it("explicit constructor args win over env", () => {
    process.env.LITELLM_API_KEY = "from-env";
    const c = new LLMConfig({ apiKey: "explicit" });
    expect(c.apiKey).toBe("explicit");
  });

  it("LITELLM_API_KEY beats VITE_LITELLM_KEY", () => {
    process.env.LITELLM_API_KEY = "primary";
    process.env.VITE_LITELLM_KEY = "framework-bridge";
    const c = new LLMConfig();
    expect(c.apiKey).toBe("primary");
  });

  it("falls back to VITE_LITELLM_KEY when LITELLM_API_KEY is unset", () => {
    process.env.VITE_LITELLM_KEY = "from-vite";
    const c = new LLMConfig();
    expect(c.apiKey).toBe("from-vite");
  });

  it("envAliases prepend their lookup before defaults", () => {
    process.env.AI_BASE_URL = "http://aliased";
    process.env.AI_API_KEY = "aliased-key";
    const c = new LLMConfig({
      envAliases: { baseUrl: ["AI_BASE_URL"], apiKey: ["AI_API_KEY"] },
    });
    expect(c.baseUrl).toBe("http://aliased");
    expect(c.apiKey).toBe("aliased-key");
  });

  it("isRemote detects non-localhost", () => {
    expect(new LLMConfig({ baseUrl: "http://localhost:4000" }).isRemote).toBe(false);
    expect(new LLMConfig({ baseUrl: "http://127.0.0.1:4000" }).isRemote).toBe(false);
    expect(new LLMConfig({ baseUrl: "https://litellm.talos00" }).isRemote).toBe(true);
  });

  it("authHeader includes Bearer when key set, omits when empty", () => {
    expect(new LLMConfig({ apiKey: "sk-abc" }).authHeader).toEqual({
      Authorization: "Bearer sk-abc",
    });
    expect(new LLMConfig({ apiKey: "" }).authHeader).toEqual({});
  });
});
