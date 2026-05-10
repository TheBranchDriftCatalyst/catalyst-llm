/**
 * In-memory tool registry. Hosts (the playground, embedded apps,
 * tests) instantiate one and register tools; pass it to
 * `client.streamChat({..., tools: registry})` to enable function
 * calling on a request.
 *
 * No singleton on purpose — different surfaces (Chat vs Compare)
 * can run with different tool sets, and tests need clean instances.
 */
import type {
  OpenAITool,
  ToolContext,
  ToolDefinition,
} from "./types.js";
import { ToolError } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  /** Register or replace a tool. Returns `this` for chaining. */
  register<TArgs, TResult>(def: ToolDefinition<TArgs, TResult>): this {
    if (!def.name) throw new ToolError("tool definition missing name");
    if (typeof def.handler !== "function") {
      throw new ToolError(`tool ${def.name} missing handler`, def.name);
    }
    this.tools.set(def.name, def);
    return this;
  }

  /** Remove a tool by name. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** True if a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Snapshot of registered tools — stable order (insertion order). */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Render the registry as the OpenAI-shape tools array. Result is
   * safe to pass into `body.tools` on a chat completion request.
   * Categories / transport metadata are dropped — they're
   * registry-side concerns the model doesn't need.
   */
  toOpenAI(): OpenAITool[] {
    return this.list().map(
      (t): OpenAITool => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }),
    );
  }

  /**
   * Invoke a tool by name. Throws ToolError on miss; bubbles handler
   * errors as ToolError with the original error preserved on `cause`.
   * Result is JSON-stringified by the streaming loop — handlers
   * should return plain JSON-able values.
   */
  async invoke(
    name: string,
    args: unknown,
    ctx: ToolContext = {},
  ): Promise<unknown> {
    const def = this.tools.get(name);
    if (!def) {
      throw new ToolError(`unknown tool: ${name}`, name);
    }
    try {
      return await def.handler(args, ctx);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(
        `tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        name,
        err,
      );
    }
  }
}
