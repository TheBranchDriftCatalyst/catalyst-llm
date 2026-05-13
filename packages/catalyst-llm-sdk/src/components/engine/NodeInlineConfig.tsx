/**
 * Compact, schema-driven inline form that renders one row per field
 * INSIDE a reactflow node card. Mirrors AgentConfigForm's widget
 * dispatch but with tighter sizing for in-graph editing:
 *
 *   - model         → ModelMicroSwitcher (the existing compact chip)
 *   - textarea (system_prompt) → prompt-icon button; clicking it
 *                                fires `onOpenPromptSheet` which the
 *                                topology routes up to the EnginePage
 *                                sheet controller. Body of the sheet
 *                                lands in T8 (llm-ta1).
 *   - number / integer with min/max → thin slider + tabular-nums value
 *   - boolean       → switch
 *   - string enum   → small select
 *   - string default → tight input
 *
 * Per row: label (truncated) + control + an inline reset (visible only
 * when the field is overridden). Height per row ≈ 28px so a card with
 * 5-6 fields stays under ~250px.
 *
 * The container's own padding + the prompt button row are the caller's
 * responsibility — NodeInlineConfig just emits the field stack.
 */
import type { ComponentType } from "react";
import { useMemo } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Slider as RawSlider } from "@thebranchdriftcatalyst/catalyst-ui/ui/slider";
import { Switch } from "@thebranchdriftcatalyst/catalyst-ui/ui/switch";
import { FileText, RotateCcw } from "lucide-react";
import type {
  AgentConfigSchema,
  AgentFieldSchema,
} from "../../agent/events.js";
import { usePromptStore } from "../../react/promptStore.js";
import { ModelMicroSwitcher } from "../ModelMicroSwitcher.js";
import { cn } from "../utils.js";

// Same cast shape AgentConfigForm uses — catalyst-ui's Slider extends
// Radix SliderPrimitive.Root, but the peer-dep types don't resolve
// cleanly from this consumer.
type SliderShape = ComponentType<{
  value?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}>;
const Slider = RawSlider as SliderShape;

export interface NodeInlineConfigProps {
  schema: AgentConfigSchema;
  /** Effective values (merged: overrides ?? defaults) per field. */
  values: Record<string, unknown>;
  /** Which keys the operator has explicitly overridden — drives the
   * inline "reset" affordance per field. */
  overrideKeys: Set<string>;
  /** Set a single field. `value === undefined` clears the override
   * (restoring the schema default at dispatch time). */
  onChange: (fieldName: string, value: unknown) => void;
  /** Called when the user clicks the prompt-icon button for a
   * `widget: "textarea"` field (typically `system_prompt`). */
  onOpenPromptSheet?: (fieldName: string) => void;
  className?: string;
}

export function NodeInlineConfig({
  schema,
  values,
  overrideKeys,
  onChange,
  onOpenPromptSheet,
  className,
}: NodeInlineConfigProps) {
  const fields = useMemo(() => {
    const props = schema.properties || {};
    // Skip any field whose schema marks it `ui.widget = "hidden"`.
    // Today that's `system_prompt_ref` on agent node configs — it's a
    // companion to `system_prompt` and is bound via the prompt-icon
    // button + sheet (T8), not by an inline form control.
    return Object.entries(props)
      .filter(([, field]) => field.ui?.widget !== "hidden")
      .map(([name, field]) => ({ name, field }));
  }, [schema]);

  if (fields.length === 0) {
    return (
      <div className={cn("text-[10px] text-muted-foreground", className)}>
        no tunable fields
      </div>
    );
  }

  // The textarea (system_prompt) row's label depends on whether the
  // node is bound to a saved preset via the hidden `system_prompt_ref`
  // companion field. Resolve the preset name here so FieldRow gets a
  // ready-to-render string and stays presentational.
  const systemPromptRef =
    typeof values.system_prompt_ref === "string"
      ? values.system_prompt_ref
      : undefined;
  const boundPresetName = usePromptStore((s) =>
    systemPromptRef
      ? (s.presets.find((p) => p.id === systemPromptRef)?.name ?? null)
      : null,
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {fields.map(({ name, field }) => (
        <FieldRow
          key={name}
          fieldName={name}
          field={field}
          value={values[name]}
          isOverridden={overrideKeys.has(name)}
          onChange={(v) => onChange(name, v)}
          onReset={() => onChange(name, undefined)}
          onOpenPromptSheet={onOpenPromptSheet}
          boundPresetName={boundPresetName}
        />
      ))}
    </div>
  );
}

function FieldRow({
  fieldName,
  field,
  value,
  isOverridden,
  onChange,
  onReset,
  onOpenPromptSheet,
  boundPresetName,
}: {
  fieldName: string;
  field: AgentFieldSchema;
  value: unknown;
  isOverridden: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
  onOpenPromptSheet?: (fieldName: string) => void;
  /** When the node has a `system_prompt_ref` bound to a saved preset
   * that the prompt store can resolve, this is its display name.
   * Otherwise null. The textarea row uses it to render a binding hint
   * ("using: <name>") in place of the generic "default" / "edited"
   * label. */
  boundPresetName?: string | null;
}) {
  const label = field.title ?? fieldName;

  // system_prompt-style textareas don't fit on a node card. Render as
  // a button that opens the prompt explorer sheet. The button label
  // surfaces the current binding state so the operator can see at a
  // glance whether the node is on a saved preset, a one-off inline
  // override, or the schema default.
  if (field.ui?.widget === "textarea") {
    let buttonLabel: string;
    let titleHint: string;
    if (boundPresetName) {
      // Names get long — truncate at ~16 chars so the row stays one
      // line on a typical card width.
      const truncated =
        boundPresetName.length > 16
          ? `${boundPresetName.slice(0, 15)}…`
          : boundPresetName;
      buttonLabel = `using: ${truncated}`;
      titleHint = `Bound to saved prompt "${boundPresetName}" — click to manage`;
    } else if (isOverridden) {
      buttonLabel = "(inline)";
      titleHint = `Inline ${label} override — click to manage`;
    } else {
      buttonLabel = "default";
      titleHint = `Edit ${label}`;
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-[80px] shrink-0 truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenPromptSheet?.(fieldName)}
          className="h-6 flex-1 justify-start px-2 text-[11px]"
          title={titleHint}
        >
          <FileText className="mr-1 h-3 w-3" aria-hidden="true" />
          <span className="truncate">{buttonLabel}</span>
        </Button>
        {isOverridden && <ResetButton onReset={onReset} />}
      </div>
    );
  }

  // Model micro-switcher — full-width inside the row; the label sits
  // above it because the switcher chip already has its own iconography
  // and a label-on-left arrangement crowds it.
  if (field.ui?.widget === "model") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-[80px] shrink-0 truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <div className="nodrag nopan nowheel flex-1">
          <ModelMicroSwitcher
            value={String(value ?? "")}
            onChange={(v) => onChange(v)}
            className="w-full"
          />
        </div>
        {isOverridden && <ResetButton onReset={onReset} />}
      </div>
    );
  }

  // Number / integer → thin slider + value readout
  if (field.type === "number" || field.type === "integer") {
    const min = field.minimum ?? 0;
    const max = field.maximum ?? 100;
    const step = field.ui?.step ?? (field.type === "integer" ? 1 : 0.05);
    const num = typeof value === "number" ? value : Number(value ?? 0);
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-[80px] shrink-0 truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <div className="nodrag nopan nowheel flex-1">
          <Slider
            value={[num]}
            min={min}
            max={max}
            step={step}
            onValueChange={(values: number[]) => onChange(values[0])}
            className="flex-1"
          />
        </div>
        <span className="w-[44px] shrink-0 text-right font-mono text-[10px] tabular-nums">
          {field.type === "integer" ? Math.round(num) : num.toFixed(2)}
        </span>
        {isOverridden && <ResetButton onReset={onReset} />}
      </div>
    );
  }

  // Boolean → switch
  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="flex-1 truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <div className="nodrag nopan">
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(v)}
          />
        </div>
        {isOverridden && <ResetButton onReset={onReset} />}
      </div>
    );
  }

  // String with enum → tight select
  if (field.type === "string" && field.enum && field.enum.length > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-[80px] shrink-0 truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        <div className="nodrag nopan nowheel flex-1">
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-full rounded border border-border bg-background px-1 text-[11px]"
          >
            {field.enum.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        {isOverridden && <ResetButton onReset={onReset} />}
      </div>
    );
  }

  // Default: short string
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[80px] shrink-0 truncate text-[10px] text-muted-foreground">
        {label}
      </span>
      <div className="nodrag nopan nowheel flex-1">
        <Input
          type={field.ui?.secret ? "password" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 px-2 text-[11px]"
        />
      </div>
      {isOverridden && <ResetButton onReset={onReset} />}
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="Revert to default"
      className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground"
    >
      <RotateCcw className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
