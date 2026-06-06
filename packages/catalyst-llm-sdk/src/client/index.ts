export * from "./types.js";
export { LLMConfig, type LLMConfigInit } from "./config.js";
export { getEndpointInfo } from "./endpoints.js";
export { parseSSEChunks } from "./streaming.js";
export { CatalystLLMClient } from "./client.js";
// Strategy pattern for the catalogue useModels() returns. Hosts pick
// the source at <LLMProvider> mount time and can swap implementations
// (LiteLLM ↔ Ollama ↔ custom) with one prop change.
export {
  type ModelSource,
  LiteLLMModelSource,
  StaticModelSource,
  HttpModelSource,
  OllamaModelSource,
} from "./modelSources.js";
export {
  modelSupportsReasoning,
  isEmbeddingModel,
  getModelCapabilities,
  groupModelsByFamily,
  type ModelCapabilities,
} from "./capabilities.js";
export { inferModelHints, effectiveMetadata } from "./modelHints.js";
