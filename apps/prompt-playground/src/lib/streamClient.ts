import type { Message, ChatParams } from './litellm';

const LITELLM_URL = import.meta.env.VITE_LITELLM_URL || 'http://litellm.talos00';
const API_KEY = import.meta.env.VITE_LITELLM_KEY || '';

export interface StreamMeta {
  id?: string;
  model?: string;
  created?: number;
  finish_reason?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export type StreamCallback = (
  chunk: string,
  done: boolean,
  meta?: StreamMeta
) => void;

class StreamClient {
  private subscribers = new Map<string, StreamCallback>();
  private abortControllers = new Map<string, AbortController>();

  subscribe(chatId: string, callback: StreamCallback): () => void {
    this.subscribers.set(chatId, callback);
    return () => this.subscribers.delete(chatId);
  }

  abort(chatId: string): void {
    const controller = this.abortControllers.get(chatId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(chatId);
    }
  }

  async stream(
    chatId: string,
    messages: Message[],
    model: string,
    params: ChatParams = {}
  ): Promise<void> {
    const callback = this.subscribers.get(chatId);
    if (!callback) {
      console.warn(`No subscriber for chat ${chatId}`);
      return;
    }

    // Abort any existing stream for this chat
    this.abort(chatId);

    const controller = new AbortController();
    this.abortControllers.set(chatId, controller);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    try {
      const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          ...params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Stream failed: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let meta: StreamMeta = {};

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          callback('', true, meta);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            callback('', true, meta);
            return;
          }

          try {
            const json = JSON.parse(data);

            // Extract metadata
            if (json.id) meta.id = json.id;
            if (json.model) meta.model = json.model;
            if (json.created) meta.created = json.created;
            if (json.usage) meta.usage = json.usage;

            const choice = json.choices?.[0];
            if (choice) {
              const content = choice.delta?.content || '';
              if (choice.finish_reason) {
                meta.finish_reason = choice.finish_reason;
              }
              if (content) {
                callback(content, false, meta);
              }
            }
          } catch {
            // Skip malformed JSON
            console.warn('Failed to parse SSE chunk:', data);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        callback('', true, { finish_reason: 'abort' });
      } else {
        throw error;
      }
    } finally {
      this.abortControllers.delete(chatId);
    }
  }
}

export const streamClient = new StreamClient();
