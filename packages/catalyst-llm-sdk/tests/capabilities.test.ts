import { describe, it, expect } from "vitest";
import {
  modelSupportsReasoning,
  isEmbeddingModel,
  groupModelsByFamily,
} from "../src/client/index.js";

describe("modelSupportsReasoning", () => {
  it.each([
    "o1-preview",
    "o3-mini",
    "o4-pro",
    "gpt-5-thinking",
    "gpt-5-pro",
    "claude-3-7-sonnet-latest",
    "claude-opus-4-1-20250101",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5",
    "deepseek-r1-distill-llama",
    "Qwen/QwQ-32B",
    "qwen3-32b-thinking",
    "reflection-llama-3.1-70b",
  ])("recognizes reasoning model %s", (id) => {
    expect(modelSupportsReasoning(id)).toBe(true);
  });

  it.each([
    "gpt-4o-mini",
    "claude-3-5-sonnet",
    "claude-2.1",
    "llama3.2",
    "mistral-7b",
    "",
    null,
    undefined,
  ])("does not flag non-reasoning model %s", (id) => {
    expect(modelSupportsReasoning(id)).toBe(false);
  });

  it("strips backend prefix before matching", () => {
    expect(modelSupportsReasoning("litellm:claude-sonnet-4-20250514")).toBe(true);
    expect(modelSupportsReasoning("ollama:qwen3-7b-thinking")).toBe(true);
  });
});

describe("isEmbeddingModel", () => {
  it("matches embedding ids", () => {
    expect(isEmbeddingModel("text-embedding-3-small")).toBe(true);
    expect(isEmbeddingModel("nomic-embed-text")).toBe(true);
    expect(isEmbeddingModel("mxbai-embed-large")).toBe(true);
  });

  it("does not match chat ids", () => {
    expect(isEmbeddingModel("gpt-4o-mini")).toBe(false);
    expect(isEmbeddingModel("claude-sonnet-4")).toBe(false);
  });
});

describe("groupModelsByFamily", () => {
  it("buckets by provider prefix", () => {
    const groups = groupModelsByFamily([
      { id: "claude-sonnet-4-20250514" },
      { id: "claude-haiku-4-5" },
      { id: "gpt-4o-mini" },
      { id: "o3-mini" },
      { id: "runpod-dolphin" },
      { id: "ollama/qwen3-7b" },
      { id: "hermes3:8b" },
      { id: "text-embedding-3-small" }, // filtered
    ]);
    const labels = groups.map((g) => g.label).sort();
    expect(labels).toContain("anthropic");
    expect(labels).toContain("openai");
    expect(labels).toContain("runpod");
    expect(labels).toContain("ollama");
    const anthropic = groups.find((g) => g.label === "anthropic")!;
    expect(anthropic.ids).toEqual(anthropic.ids.slice().sort());
  });

  it("filters out embedding models", () => {
    const groups = groupModelsByFamily([
      { id: "claude-sonnet-4" },
      { id: "text-embedding-3-large" },
    ]);
    const all = groups.flatMap((g) => g.ids);
    expect(all).not.toContain("text-embedding-3-large");
  });
});
