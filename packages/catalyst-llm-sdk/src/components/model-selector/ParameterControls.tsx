import type { ComponentType } from "react";
import { Slider as RawSlider } from "@thebranchdriftcatalyst/catalyst-ui/ui/slider";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import { Brain } from "lucide-react";
import type { ChatParams, ModelWithRouting } from "../../client/index.js";
import { effectiveMetadata } from "../../client/modelHints.js";
import { cn } from "../utils.js";

// catalyst-ui's Slider extends Radix's SliderPrimitive.Root, but Radix's
// peer-dep types aren't resolvable from this consumer without bringing the
// whole Radix tree into devDeps. Cast to a focused shape that captures the
// props we actually pass — runtime contract is unchanged.
type SliderShape = ComponentType<{
  value?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}>;
const Slider = RawSlider as SliderShape;

export interface ParameterControlsProps {
  params: ChatParams;
  onChange: (params: Partial<ChatParams>) => void;
  /** Pass the active model so reasoning controls auto-show for capable models. */
  model?: ModelWithRouting;
}

const REASONING_LEVELS: Array<NonNullable<ChatParams["reasoning_effort"]>> = [
  "low",
  "medium",
  "high",
];

export function ParameterControls({
  params,
  onChange,
  model,
}: ParameterControlsProps) {
  // Use effective metadata so well-known reasoning models (DeepSeek R1, QwQ,
  // o-series, Claude 4, etc.) light up the control even when LiteLLM didn't
  // ship metadata for the underlying local model.
  const supportsReasoning =
    effectiveMetadata(model).supports_reasoning === true;
  return (
    <div className="space-y-5">
      <Label className="text-sm font-semibold">Parameters</Label>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Temperature</Label>
          <span className="text-muted-foreground tabular-nums">
            {(params.temperature ?? 0.7).toFixed(1)}
          </span>
        </div>
        <Slider
          value={[params.temperature ?? 0.7]}
          onValueChange={([temperature]) => onChange({ temperature })}
          min={0}
          max={2}
          step={0.1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Max Tokens</Label>
          <span className="text-muted-foreground tabular-nums">
            {params.max_tokens ?? 2048}
          </span>
        </div>
        <Slider
          value={[params.max_tokens ?? 2048]}
          onValueChange={([max_tokens]) => onChange({ max_tokens })}
          min={64}
          max={8192}
          step={64}
        />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Top P</Label>
          <span className="text-muted-foreground tabular-nums">
            {(params.top_p ?? 1.0).toFixed(2)}
          </span>
        </div>
        <Slider
          value={[params.top_p ?? 1.0]}
          onValueChange={([top_p]) => onChange({ top_p })}
          min={0}
          max={1}
          step={0.05}
        />
      </div>

      {supportsReasoning && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-sm">
            <Label className="flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5 text-primary" />
              Reasoning effort
            </Label>
          </div>
          <div
            role="group"
            aria-label="Reasoning effort"
            className="grid grid-cols-4 gap-1"
          >
            {(["off", ...REASONING_LEVELS] as const).map((level) => {
              const isOff = level === "off";
              const active = isOff
                ? !params.reasoning_effort
                : params.reasoning_effort === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChange({ reasoning_effort: isOff ? undefined : level })
                  }
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
