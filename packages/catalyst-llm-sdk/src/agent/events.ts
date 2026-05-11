/**
 * TypeScript mirror of catalyst-langgraph's AgentEvent union.
 *
 * The Python source of truth lives at
 *   packages/catalyst-langgraph/src/catalyst_langgraph/events.py
 *
 * Each event in the union carries a discriminating `type` field so
 * consumers can switch over it (or filter via `event.type === "token"`)
 * without runtime tag inspection. Keep this file in lock-step with
 * the Python schema — adding an event there but not here means the
 * UI silently drops events; vice-versa means we'll log "unknown type"
 * warnings until the backend ships matching code.
 */

export interface RunStarted {
  type: "run_started";
  run_id: string;
  model: string;
}

export interface Token {
  type: "token";
  content: string;
}

/** Reasoning-trace deltas (e.g. `<think>` blocks from r1-style models). */
export interface Reasoning {
  type: "reasoning";
  content: string;
}

export interface ToolCallStart {
  type: "tool_call_start";
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallEnd {
  type: "tool_call_end";
  id: string;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

export interface Iteration {
  type: "iteration";
  n: number;
}

export interface MessageDone {
  type: "message_done";
  finish_reason?: string;
  usage?: Record<string, unknown>;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type AgentEvent =
  | RunStarted
  | Token
  | Reasoning
  | ToolCallStart
  | ToolCallEnd
  | Iteration
  | MessageDone
  | ErrorEvent;

/** All event-type discriminators in one place, useful for exhaustiveness checks. */
export const AGENT_EVENT_TYPES = [
  "run_started",
  "token",
  "reasoning",
  "tool_call_start",
  "tool_call_end",
  "iteration",
  "message_done",
  "error",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Body shape for POST /api/chat/stream. */
export interface ChatStreamRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
    [key: string]: unknown;
  }>;
  system_prompt?: string;
  /** Tool names the agent may dispatch (must be in /api/tools). */
  tools?: string[];
  /** Sampling params: temperature, max_tokens, top_p, reasoning_effort, … */
  params?: Record<string, unknown>;
}
