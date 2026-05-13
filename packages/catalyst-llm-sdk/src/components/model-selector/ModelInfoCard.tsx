import {
  Eye,
  Wrench,
  Brain,
  FileText,
  Database,
  MousePointerClick,
  Cpu,
  Cloud,
  Server,
  Monitor,
  ExternalLink,
  Scale,
} from "lucide-react";
import { Badge } from "@thebranchdriftcatalyst/catalyst-ui/ui/badge";
import type { ModelWithRouting } from "../../client/index.js";
import { effectiveMetadata } from "../../client/modelHints.js";
import { cn } from "../utils.js";

export interface ModelInfoCardProps {
  model: ModelWithRouting;
  /** Render a denser variant for use inside dropdowns. */
  compact?: boolean;
  className?: string;
}

const ENDPOINT_ICON = {
  mac: Monitor,
  cluster: Server,
  cloud: Cloud,
} as const;

interface CapDef {
  key: keyof NonNullable<ModelWithRouting["metadata"]>;
  label: string;
  icon: React.ElementType;
}

const CAPABILITIES: CapDef[] = [
  { key: "supports_vision", label: "vision", icon: Eye },
  { key: "supports_function_calling", label: "tools", icon: Wrench },
  { key: "supports_reasoning", label: "reasoning", icon: Brain },
  { key: "supports_pdf_input", label: "pdf", icon: FileText },
  { key: "supports_prompt_caching", label: "cache", icon: Database },
  { key: "supports_computer_use", label: "computer", icon: MousePointerClick },
];

/** Pretty-format a per-token price as $/1M tokens. Returns null if unset/zero. */
function pricePerMillion(perToken?: number): string | null {
  if (!perToken || perToken <= 0) return null;
  const perM = perToken * 1_000_000;
  if (perM >= 1) return `$${perM.toFixed(2)}/M`;
  return `$${perM.toFixed(3)}/M`;
}

function formatContext(n?: number): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function formatParams(n?: number): string | null {
  if (!n) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  return `${n}`;
}

/** Tiny inline pill — used a lot in compact mode. */
function Chip({
  icon: Icon,
  children,
  tone = "muted",
  title,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
  tone?: "muted" | "primary" | "outline";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap",
        tone === "primary"
          ? "bg-primary/15 text-primary"
          : tone === "outline"
            ? "border border-border bg-transparent"
            : "bg-muted/40",
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5 opacity-80" />}
      {children}
    </span>
  );
}

export function ModelInfoCard({
  model,
  compact = false,
  className,
}: ModelInfoCardProps) {
  // effectiveMetadata layers heuristic hints in for local models that LiteLLM
  // doesn't have a metadata entry for — so DeepSeek R1, Llama 3.x, etc. get
  // a context window + reasoning badge instead of looking like blank stubs.
  const meta = effectiveMetadata(model);
  const provider = meta?.litellm_provider ?? model.endpoint?.label ?? "—";
  const EndpointIcon = ENDPOINT_ICON[model.endpoint?.type ?? "cloud"];
  const ctx = formatContext(meta?.max_input_tokens ?? meta?.max_tokens);
  const params = formatParams(meta?.param_count);
  const inPrice = pricePerMillion(meta?.input_cost_per_token);
  const outPrice = pricePerMillion(meta?.output_cost_per_token);
  const isLocal = !inPrice && !outPrice;
  const caps = CAPABILITIES.filter((c) => meta?.[c.key] === true);

  // ── Compact (dropdown row) layout: dense two-line grid ──
  // Goal: every datapoint visible without expanding, but each row stays
  // under ~3 grid lines.
  if (compact) {
    return (
      <div
        className={cn(
          "rounded-md border border-border/40 bg-card/30 px-2 py-1.5 space-y-1",
          className,
        )}
      >
        {/* Row 1 — full model name on its own line, never truncated */}
        <div className="flex items-center gap-1.5">
          <EndpointIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="break-all font-mono text-[12px] font-semibold leading-tight">
            {model.id}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/80">
            {provider}
          </span>
        </div>
        {/* Row 2 — sizing & pricing */}
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {params && (
            <Chip tone="outline" title="Parameter count from HF">
              {params}
            </Chip>
          )}
          {ctx && (
            <Chip icon={Cpu} title="Context window">
              {ctx}
            </Chip>
          )}
          {inPrice && <Chip>in {inPrice}</Chip>}
          {outPrice && <Chip>out {outPrice}</Chip>}
          {isLocal && (
            <Chip tone="primary" title="No per-token cost — runs on your hardware">
              free
            </Chip>
          )}
          {meta.license && (
            <Chip icon={Scale} title="License (from HF model card)">
              {meta.license}
            </Chip>
          )}
          {meta.pipeline_tag && (
            <Chip title="HF pipeline tag">{meta.pipeline_tag}</Chip>
          )}
        </div>
        {/* Row 3 — capability badges (only when present) */}
        {caps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {caps.map(({ key, label, icon: Icon }) => (
              <span
                key={key}
                title={label}
                className="inline-flex items-center gap-0.5 rounded-sm border border-primary/30 bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary"
              >
                <Icon className="h-2.5 w-2.5" />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Full card (sidebar / standalone) layout ──
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border/50 bg-card/40 p-3",
        className,
      )}
    >
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <EndpointIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="break-all font-mono text-sm font-semibold leading-tight">
            {model.id}
          </span>
          <Badge
            variant={isLocal ? "secondary" : "outline"}
            className="ml-auto shrink-0 text-[10px]"
          >
            {provider}
          </Badge>
        </div>
        {(model.underlyingModel || model.endpoint?.apiBase) && (
          <div className="break-all text-[10px] text-muted-foreground">
            {model.underlyingModel ?? ""}
            {model.underlyingModel && model.endpoint?.apiBase ? " · " : ""}
            {model.endpoint?.apiBase
              ?.replace(/^https?:\/\//, "")
              .split("/")[0] ?? ""}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {params && (
          <Chip tone="outline" title="Parameter count">
            {params}
          </Chip>
        )}
        {ctx && (
          <Chip icon={Cpu} title="Context window">
            {ctx} ctx
          </Chip>
        )}
        {inPrice && <Chip>in {inPrice}</Chip>}
        {outPrice && <Chip>out {outPrice}</Chip>}
        {isLocal && (
          <Chip tone="primary">free / local</Chip>
        )}
        {meta.license && (
          <Chip icon={Scale} title="License (from HF)">
            {meta.license}
          </Chip>
        )}
        {meta.pipeline_tag && (
          <Chip title="HF pipeline tag">{meta.pipeline_tag}</Chip>
        )}
      </div>

      {caps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {caps.map(({ key, label, icon: Icon }) => (
            <span
              key={key}
              title={label}
              className="inline-flex items-center gap-0.5 rounded-sm border border-primary/30 bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary"
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
            </span>
          ))}
        </div>
      )}

      {meta?.description && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {meta.description}
        </p>
      )}

      {meta.hf_repo && (
        <a
          href={`https://huggingface.co/${meta.hf_repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          huggingface.co/{meta.hf_repo}
        </a>
      )}
    </div>
  );
}
