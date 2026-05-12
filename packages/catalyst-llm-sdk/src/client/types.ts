export type Role = "system" | "user" | "assistant" | "tool";

/**
 * One outstanding tool invocation requested by the model. The
 * arguments come back as a JSON-encoded string — that's the OpenAI
 * wire shape, not a parsing oversight on our end.
 */
export interface AssistantToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  /** Set on assistant turns when the model wants to invoke tools. */
  tool_calls?: AssistantToolCall[];
}

export interface ChatParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  /**
   * Unified LiteLLM reasoning control. Accepted values across providers
   * (LiteLLM translates per backend):
   * - `"none"` — disable thinking entirely
   * - `"minimal"` — OpenAI gpt-5+ only
   * - `"low"` | `"medium"` | `"high"` — universal across reasoning models
   * - `"xhigh"` — Anthropic Opus 4.7, OpenAI gpt-5.1-codex-max / gpt-5.2
   * - `"max"` — Anthropic Claude 4.6 only
   *
   * Maps to OpenAI's `reasoning_effort` directly and to Anthropic's
   * `output_config.effort` (with adaptive thinking) under the hood. Models
   * without reasoning support silently ignore this — gate the UI on
   * `metadata.supports_reasoning`.
   */
  reasoning_effort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  /**
   * Ollama-style keep_alive — forwarded as-is by LiteLLM to the Ollama
   * backend. Use `0` to unload the model from memory immediately after the
   * request completes; `"30m"` etc. to override the default. No-op for
   * non-Ollama backends.
   */
  keep_alive?: number | string;
}

export interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelInfo {
  model_name: string;
  litellm_params?: {
    api_base?: string;
    model?: string;
  };
  model_info?: ModelMetadata;
}

/**
 * Subset of LiteLLM's `/model/info` `model_info` payload that we surface to
 * UI components. Captures pricing, context window, capability flags, and
 * provider routing.
 */
export interface ModelMetadata {
  id?: string;
  mode?: string;
  litellm_provider?: string;
  description?: string;
  max_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  supports_vision?: boolean | null;
  supports_function_calling?: boolean | null;
  supports_tool_choice?: boolean | null;
  supports_reasoning?: boolean | null;
  supports_prompt_caching?: boolean | null;
  supports_pdf_input?: boolean | null;
  supports_response_schema?: boolean | null;
  supports_computer_use?: boolean | null;
  supported_openai_params?: string[];
  // ── Hugging Face supplements (set by mac-node gen-litellm.py) ──
  license?: string;
  pipeline_tag?: string;
  param_count?: number;
  hf_repo?: string;
  hf_tags?: string[];
}

export type EndpointType = "mac" | "cluster" | "cloud";

export interface EndpointInfo {
  label: string;
  type: EndpointType;
  apiBase?: string;
}

export interface ModelWithRouting extends Model {
  endpoint?: EndpointInfo;
  /** Enriched metadata from LiteLLM /model/info — pricing, capabilities, context. */
  metadata?: ModelMetadata;
  /** Provider/model name as litellm sees it (e.g. "anthropic/claude-...", "ollama/qwen3:32b"). */
  underlyingModel?: string;
}

export interface ChatChoice {
  index: number;
  message: Message;
  finish_reason: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: TokenUsage;
}

export interface StreamMeta {
  id?: string;
  model?: string;
  created?: number;
  finish_reason?: string | null;
  usage?: Partial<TokenUsage>;
  /**
   * Cancel-bus signalling (catalyst-langgraph). When `finish_reason`
   * is "abort" and the server sent a structured `cancelled` event
   * (rather than the connection just dropping), these carry the
   * reason and the list of in-flight tool_call_ids the cancel was
   * propagated to. UIs use them to render "stopped — N sub-agents
   * heard it" instead of guessing.
   */
  cancel_reason?: string;
  cancel_propagated_to?: string[];
}

export interface ChatChunk {
  delta: string;
  meta: StreamMeta;
  done: boolean;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  params?: ChatParams;
  signal?: AbortSignal;
}

export interface EmbedRequest {
  model: string;
  input: string | string[];
}

export interface EmbedItem {
  embedding: number[];
  index: number;
  object: string;
}

export interface EmbedResponse {
  data: EmbedItem[];
  model: string;
  object: string;
  usage: { prompt_tokens: number; total_tokens: number };
}
