import { describe, it, expect } from "vitest";
import { getEndpointInfo } from "../src/client/index.js";

describe("getEndpointInfo", () => {
  it("returns Cloud for missing apiBase", () => {
    expect(getEndpointInfo()).toMatchObject({ type: "cloud", label: "Cloud" });
  });

  it.each([
    ["http://localhost:11434", "mac"],
    ["http://127.0.0.1:11434", "mac"],
    ["http://192.168.1.86:11434", "mac"],
    ["http://10.0.0.5/api", "mac"],
    ["http://litellm.catalyst-llm.svc.cluster.local:4000", "cluster"],
    ["http://litellm.talos00", "cluster"],
    ["https://api.openai.com/v1", "cloud"],
    ["https://api.anthropic.com/v1", "cloud"],
    ["https://api.runpod.ai/v2/abc", "cloud"],
  ])("classifies %s as %s", (url, type) => {
    expect(getEndpointInfo(url).type).toBe(type);
  });

  it("falls back to host label for unknown urls", () => {
    const info = getEndpointInfo("https://my-internal.example.com/v1");
    expect(info.label).toBe("my-internal.example.com");
  });
});
