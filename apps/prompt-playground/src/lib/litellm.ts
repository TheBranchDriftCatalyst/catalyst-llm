const LITELLM_URL = import.meta.env.VITE_LITELLM_URL || 'http://litellm.talos00';
const API_KEY = import.meta.env.VITE_LITELLM_KEY || '';

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
  };
}

export interface ModelWithRouting extends Model {
  endpoint?: {
    label: string;
    type: 'mac' | 'cluster' | 'cloud';
    apiBase?: string;
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: Message;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function getHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

export function getEndpointInfo(apiBase?: string): { label: string; type: 'mac' | 'cluster' | 'cloud' } {
  if (!apiBase) {
    return { label: 'Cloud', type: 'cloud' };
  }
  if (apiBase.includes('192.168.1.86')) {
    return { label: 'Mac (local)', type: 'mac' };
  }
  if (apiBase.includes('cluster.local') || apiBase.includes('talos')) {
    return { label: 'Cluster', type: 'cluster' };
  }
  if (apiBase.includes('localhost') || apiBase.includes('127.0.0.1')) {
    return { label: 'Local', type: 'mac' };
  }
  // Check for known cloud providers
  if (apiBase.includes('openai.com')) {
    return { label: 'OpenAI', type: 'cloud' };
  }
  if (apiBase.includes('anthropic.com')) {
    return { label: 'Anthropic', type: 'cloud' };
  }
  return { label: apiBase.replace(/^https?:\/\//, '').split('/')[0], type: 'cluster' };
}

export async function fetchModels(): Promise<Model[]> {
  const response = await fetch(`${LITELLM_URL}/v1/models`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.data || [];
}

export async function fetchModelInfo(): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${LITELLM_URL}/model/info`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      console.warn('Model info endpoint not available');
      return [];
    }
    const data = await response.json();
    return data.data || [];
  } catch {
    console.warn('Failed to fetch model info');
    return [];
  }
}

export async function fetchModelsWithRouting(): Promise<ModelWithRouting[]> {
  const [models, modelInfo] = await Promise.all([
    fetchModels(),
    fetchModelInfo(),
  ]);

  const infoMap = new Map(modelInfo.map(m => [m.model_name, m]));

  return models.map(model => {
    const info = infoMap.get(model.id);
    const apiBase = info?.litellm_params?.api_base;
    return {
      ...model,
      endpoint: {
        ...getEndpointInfo(apiBase),
        apiBase,
      },
    };
  });
}

export async function chat(
  messages: Message[],
  model: string,
  params: ChatParams = {}
): Promise<ChatResponse> {
  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...params,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat failed: ${error}`);
  }
  return response.json();
}

export function getLiteLLMUrl(): string {
  return LITELLM_URL;
}

export function hasApiKey(): boolean {
  return !!API_KEY;
}
