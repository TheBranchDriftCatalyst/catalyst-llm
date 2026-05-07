export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
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
  model_info?: {
    id?: string;
    mode?: string;
    max_input_tokens?: number;
    max_output_tokens?: number;
    input_cost_per_token?: number;
    output_cost_per_token?: number;
  };
}

export type EndpointType = "mac" | "cluster" | "cloud";

export interface EndpointInfo {
  label: string;
  type: EndpointType;
  apiBase?: string;
}

export interface ModelWithRouting extends Model {
  endpoint?: EndpointInfo;
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
