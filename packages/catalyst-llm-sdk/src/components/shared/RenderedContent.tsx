import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Brain, ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "./utils.js";

import "katex/dist/katex.min.css";

export interface RenderedContentProps {
  /** Raw model output. May contain markdown, LaTeX, mermaid fences, and <think>. */
  content: string;
  /**
   * When true, the live token cursor is appended to the very last text node.
   * (Cosmetic — purely a streaming UX hint.)
   */
  isStreaming?: boolean;
  /** Show <think>...</think> blocks collapsed by default vs expanded. */
  thinkDefault?: "collapsed" | "expanded";
  className?: string;
}

/**
 * Renders an LLM response with markdown, GFM extensions, math (KaTeX), Mermaid
 * diagrams, fenced code blocks (with copy), and DeepSeek-style `<think>` blocks
 * extracted into a collapsible "thinking" section above the answer.
 *
 * The component is intentionally tolerant: a half-streamed `<think>` (no
 * closing tag yet) is still rendered as a thinking block so the user can
 * watch reasoning land in real time, and unbalanced LaTeX delimiters don't
 * crash the whole message — KaTeX renders what it can and leaves the rest.
 */
export const RenderedContent = memo(function RenderedContent({
  content,
  isStreaming,
  thinkDefault = "collapsed",
  className,
}: RenderedContentProps) {
  const { think, body, partialThink } = useMemo(
    () => extractThinkBlocks(content),
    [content],
  );
  const normalizedBody = useMemo(() => normalizeMath(body), [body]);

  return (
    <div className={cn("rendered-content", className)}>
      {think.map((t, i) => (
        <ThinkBlock
          key={`think-${i}`}
          text={t}
          defaultOpen={thinkDefault === "expanded"}
          live={false}
        />
      ))}
      {partialThink !== null && (
        <ThinkBlock
          // Streaming-in-progress think block — defaults to open so the user
          // can watch it land. We keep it as a separate element from the
          // closed ones so React doesn't reorder/remount.
          key="think-partial"
          text={partialThink}
          defaultOpen={true}
          live
        />
      )}
      <div className="rendered-markdown prose prose-sm max-w-none break-words text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={MARKDOWN_COMPONENTS}
        >
          {normalizedBody}
        </ReactMarkdown>
        {isStreaming && (
          <span className="streaming-cursor" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});

/**
 * Pull all complete `<think>...</think>` blocks out of the content. If the
 * stream is mid-think (open tag, no close yet), the trailing partial is
 * returned separately so we can render it live without polluting `body`.
 */
function extractThinkBlocks(input: string): {
  think: string[];
  body: string;
  partialThink: string | null;
} {
  const closed = /<think>([\s\S]*?)<\/think>/gi;
  const think: string[] = [];
  let body = input.replace(closed, (_, inner) => {
    think.push(String(inner).trim());
    return "";
  });
  let partialThink: string | null = null;
  // Detect a still-open think tag at this point (after closed ones removed).
  const open = body.match(/<think>([\s\S]*)$/i);
  if (open) {
    partialThink = String(open[1]).trim();
    body = body.slice(0, open.index);
  }
  return { think, body: body.trimStart(), partialThink };
}

/**
 * Pre-process LaTeX delimiters that some models emit (Claude / OpenAI style)
 * which `remark-math` doesn't accept by default. We map `\[...\]` to `$$...$$`
 * and `\(...\)` to `$...$` while taking care not to mangle escaped backslashes
 * inside fenced code blocks.
 */
function normalizeMath(src: string): string {
  // Split on fenced code blocks so we don't rewrite math syntax inside code.
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((chunk, i) => {
      const isCode = i % 2 === 1;
      if (isCode) return chunk;
      return chunk
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `\n$$${inner}$$\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);
    })
    .join("");
}

function ThinkBlock({
  text,
  defaultOpen,
  live,
}: {
  text: string;
  defaultOpen: boolean;
  live: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className={cn(
        "mb-3 rounded-md border border-border/60 bg-muted/20",
        live && "border-primary/40 bg-primary/5",
      )}
    >
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <Brain
          className={cn(
            "h-3 w-3 shrink-0",
            live ? "text-primary animate-pulse" : "text-primary/70",
          )}
          aria-hidden="true"
        />
        <span>{live ? "thinking…" : "thought"}</span>
        <ChevronDown
          className="ml-auto h-3 w-3 shrink-0 transition-transform [details[open]_&]:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border/40 px-3 py-2 text-xs italic text-muted-foreground">
        <pre className="whitespace-pre-wrap break-words font-sans">{text}</pre>
      </div>
    </details>
  );
}

const MARKDOWN_COMPONENTS = {
  // Strip an enclosing <p> when the only child is a block-level element we
  // render (mermaid / fenced code), so we don't get nested <pre> inside <p>.
  p({ children, ...props }: any) {
    const arr = Children.toArray(children);
    if (arr.length === 1 && isValidElement(arr[0])) {
      const child = arr[0] as any;
      if (child.props?.["data-block-passthrough"]) return <>{children}</>;
    }
    return <p {...props}>{children}</p>;
  },
  pre({ children }: any) {
    // The <code> child renders the fence container directly. Avoid double-wrapping.
    return <>{children}</>;
  },
  code(props: any) {
    const { inline, className, children, ...rest } = props;
    const text = String(children ?? "").replace(/\n$/, "");
    const lang = /language-([\w-]+)/.exec(className || "")?.[1];
    if (!inline && lang === "mermaid") {
      return <Mermaid chart={text} />;
    }
    if (!inline && lang) {
      return (
        <CodeFence lang={lang} code={text} className={className} {...rest} />
      );
    }
    if (!inline) {
      return (
        <CodeFence lang={undefined} code={text} className={className} {...rest} />
      );
    }
    return (
      <code
        className={cn(
          "rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...rest}
      >
        {children}
      </code>
    );
  },
  table({ children }: any) {
    return (
      <div className="my-3 overflow-x-auto rounded-md border border-border/60">
        <table className="w-full text-xs">{children}</table>
      </div>
    );
  },
  th({ children }: any) {
    return (
      <th className="border-b border-border bg-muted/40 px-2 py-1.5 text-left font-semibold">
        {children}
      </th>
    );
  },
  td({ children }: any) {
    return <td className="border-t border-border/40 px-2 py-1.5">{children}</td>;
  },
  a({ children, href, ...rest }: any) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
        {...rest}
      >
        {children}
      </a>
    );
  },
  blockquote({ children }: any) {
    return (
      <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  ul({ children }: any) {
    return <ul className="my-2 ml-5 list-disc space-y-0.5">{children}</ul>;
  },
  ol({ children }: any) {
    return <ol className="my-2 ml-5 list-decimal space-y-0.5">{children}</ol>;
  },
  h1({ children }: any) {
    return <h1 className="mt-3 mb-1 text-base font-bold">{children}</h1>;
  },
  h2({ children }: any) {
    return <h2 className="mt-3 mb-1 text-sm font-bold">{children}</h2>;
  },
  h3({ children }: any) {
    return <h3 className="mt-2 mb-0.5 text-sm font-semibold">{children}</h3>;
  },
  hr() {
    return <hr className="my-3 border-border/60" />;
  },
} as const;

function CodeFence({
  lang,
  code,
  className,
}: {
  lang: string | undefined;
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-block-passthrough
      className="my-1.5 overflow-hidden rounded-sm border border-border/25 bg-muted/[0.12]"
    >
      <div className="flex items-center justify-between border-b border-border/20 bg-muted/[0.10] px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span>{lang ?? "text"}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* noop — clipboard blocked, keep going */
            }
          }}
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[9px] hover:text-primary focus-visible:outline-none transition-colors"
          aria-label={copied ? "Copied" : "Copy code to clipboard"}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="h-2.5 w-2.5" aria-hidden="true" />
          )}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-2 py-1 text-[10px] leading-relaxed">
        <code className={cn("font-mono", className)}>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Lazy-loads `mermaid` on demand and renders the chart into an SVG. Mermaid
 * needs a unique DOM id per render or it caches stale results, so we mint a
 * fresh one each time and re-render whenever the chart text changes.
 */
function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const mod = await import("mermaid");
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(`m-${id}`, chart);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div
        data-block-passthrough
        className="my-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs"
      >
        <div className="mb-1 font-bold uppercase tracking-wider text-destructive">
          Mermaid render error
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive/80">
          {error}
        </pre>
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">show source</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
            {chart}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div
      data-block-passthrough
      ref={ref}
      role="img"
      aria-label="Mermaid diagram"
      className="my-2 flex justify-center overflow-x-auto rounded-md border border-border/60 bg-card/60 p-3"
    />
  );
}
