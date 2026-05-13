/**
 * Schema-driven form for an Agent's tunables.
 *
 * Takes the JSON Schema produced by Pydantic's `model_json_schema()`
 * (see /api/agents) and renders one widget per property. The widget
 * is picked by the `ui.widget` extension hint first, falling back to
 * the JSON Schema `type`:
 *
 *   ui.widget="model"     → ModelSelector (populated from /api/models)
 *   ui.widget="textarea"  → Textarea (multiline string)
 *   type=number|integer   → Slider (uses minimum/maximum + ui.step)
 *   type=string + enum    → Select
 *   type=string           → Input
 *   type=boolean          → Switch
 *
 * Values are partial overrides — only the fields the operator has
 * explicitly changed from the schema's default are kept. The
 * onChange callback receives `(fieldName, value | undefined)` where
 * `undefined` means "revert to default" (operator hit reset on this
 * one field). The parent (engineStore) drops keys with undefined
 * values so the wire payload stays clean.
 */
import type { ComponentType } from "react";
import { useMemo } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import { Slider as RawSlider } from "@thebranchdriftcatalyst/catalyst-ui/ui/slider";
import { Switch } from "@thebranchdriftcatalyst/catalyst-ui/ui/switch";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { RotateCcw } from "lucide-react";
import type {
  AgentConfigSchema,
  AgentFieldSchema,
} from "../../agent/events.js";
import { ModelSelector } from "../model-selector/ModelSelector.js";
import { cn } from "../utils.js";

// catalyst-ui's Slider extends Radix's SliderPrimitive.Root, but Radix's
// peer-dep types don't resolve cleanly from this consumer. Mirror the
// cast pattern from ParameterControls.tsx — captures the props we
// actually pass; runtime contract is unchanged.
type SliderShape = ComponentType<{
  value?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}>;
const Slider = RawSlider as SliderShape;

export interface AgentConfigFormProps {
  schema: AgentConfigSchema;
  /** Per-field overrides currently set. Missing keys = use default. */
  overrides: Record<string, unknown>;
  /** Called when a field changes. Pass `undefined` to clear (revert to default). */
  onChange: (fieldName: string, value: unknown) => void;
  /** Optional className for the root container. */
  className?: string;
}

export function AgentConfigForm({
  schema,
  overrides,
  onChange,
  className,
}: AgentConfigFormProps) {
  const fields = useMemo(() => {
    const props = schema.properties || {};
    return Object.entries(props).map(([name, field]) => ({ name, field }));
  }, [schema]);

  if (fields.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        This Agent has no tunable fields.
      </div>
    );
  }

  return (
    <form
      className={cn("flex flex-col gap-5", className)}
      onSubmit={(e) => e.preventDefault()}
    >
      {fields.map(({ name, field }) => {
        const overrideValue = overrides[name];
        const isOverridden = name in overrides;
        const currentValue = isOverridden ? overrideValue : field.default;
        return (
          <FieldRow
            key={name}
            fieldName={name}
            field={field}
            value={currentValue}
            isOverridden={isOverridden}
            onChange={(v) => onChange(name, v)}
            onReset={() => onChange(name, undefined)}
          />
        );
      })}
    </form>
  );
}

function FieldRow({
  fieldName,
  field,
  value,
  isOverridden,
  onChange,
  onReset,
}: {
  fieldName: string;
  field: AgentFieldSchema;
  value: unknown;
  isOverridden: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
}) {
  const label = field.title ?? fieldName;
  // ModelSelector ships with its own internal Label, so suppress our
  // outer label to avoid a duplicate "Model / Model" stack. The
  // `edited` chip + reset button still surface inline above.
  const useExternalLabel = field.ui?.widget !== "model";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        {useExternalLabel ? (
          <Label
            htmlFor={`engine-field-${fieldName}`}
            className="flex items-center gap-2 text-sm font-medium"
          >
            {label}
            {isOverridden && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                edited
              </span>
            )}
          </Label>
        ) : (
          <span className="flex items-center gap-2">
            {isOverridden && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                edited
              </span>
            )}
          </span>
        )}
        {isOverridden && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-6 px-2 text-[11px]"
            title="Revert to default"
          >
            <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
            reset
          </Button>
        )}
      </div>
      <FieldWidget fieldName={fieldName} field={field} value={value} onChange={onChange} />
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}

function FieldWidget({
  fieldName,
  field,
  value,
  onChange,
}: {
  fieldName: string;
  field: AgentFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const widget = field.ui?.widget;

  if (widget === "model" || (field.type === "string" && widget === undefined && fieldName === "model")) {
    // Reuse the existing ModelSelector; it pulls from /api/models and
    // handles the dropdown grouping (mac / cluster / cloud).
    return (
      <ModelSelector
        value={String(value ?? "")}
        onChange={(v) => onChange(v)}
      />
    );
  }

  if (widget === "textarea") {
    return (
      <Textarea
        id={`engine-field-${fieldName}`}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="font-mono text-xs"
      />
    );
  }

  if (field.type === "number" || field.type === "integer") {
    const min = field.minimum ?? 0;
    const max = field.maximum ?? 100;
    const step = field.ui?.step ?? (field.type === "integer" ? 1 : 0.05);
    const num = typeof value === "number" ? value : Number(value ?? 0);
    return (
      <div
        id={`engine-field-${fieldName}`}
        className="flex items-center gap-3"
      >
        <Slider
          value={[num]}
          min={min}
          max={max}
          step={step}
          onValueChange={(values: number[]) => onChange(values[0])}
          className="flex-1"
        />
        <span className="w-16 text-right font-mono text-sm tabular-nums">
          {field.type === "integer" ? Math.round(num) : num.toFixed(2)}
        </span>
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <Switch
        id={`engine-field-${fieldName}`}
        checked={Boolean(value)}
        onCheckedChange={(v) => onChange(v)}
      />
    );
  }

  // Default: short string.
  return (
    <Input
      id={`engine-field-${fieldName}`}
      type={field.ui?.secret ? "password" : "text"}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
