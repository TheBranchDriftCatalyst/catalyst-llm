import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LLMConfig } from "../src/client/index.js";

describe("LLMConfig", () => {
  const ENV_VARS = [
    "LITELLM_BASE_URL",
    "LITE_LLM_KEY",
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
    process.env.LITE_LLM_KEY = "from-env";
    const c = new LLMConfig({ apiKey: "explicit" });
    expect(c.apiKey).toBe("explicit");
  });

  it("LITE_LLM_KEY beats LITELLM_API_KEY", () => {
    process.env.LITELLM_API_KEY = "old";
    process.env.LITE_LLM_KEY = "new";
    const c = new LLMConfig();
    expect(c.apiKey).toBe("new");
  });

  it("falls back to LITELLM_API_KEY when LITE_LLM_KEY is unset", () => {
    process.env.LITELLM_API_KEY = "compat";
    const c = new LLMConfig();
    expect(c.apiKey).toBe("compat");
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
