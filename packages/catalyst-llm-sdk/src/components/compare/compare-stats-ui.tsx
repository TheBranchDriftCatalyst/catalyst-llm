/**
 * UI primitives that render compare-mode stats — the JSON-validity
 * badge that decorates each response and the small label/value chip
 * row that summarises a run's key numbers.
 */
import type { ElementType } from "react";
import { Braces, CircleAlert } from "lucide-react";
import { cn } from "../shared/utils.js";
import type { JsonCheck } from "./compare-stats.js";

export function JsonBadge({ check }: { check: JsonCheck }) {
  if (check.ok === null) return null;
  if (check.ok) {
    return (
      <span
        title={
          check.source === "raw"
            ? "Response is valid JSON (parsed raw)"
            : "Response is valid JSON, but wrapped in a markdown fence"
        }
        className={cn(
          "inline-flex items-center gap-0.5 rounded-sm border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          check.source === "raw"
            ? "border-primary/50 bg-primary/15 text-primary"
            : "border-yellow-600/50 bg-yellow-500/15 text-yellow-500",
        )}
      >
        <Braces className="h-2.5 w-2.5" />
        {check.source === "raw" ? "json" : "json (fenced)"}
      </span>
    );
  }
  return (
    <span
      title={check.error ? `Invalid JSON: ${check.error}` : "Invalid JSON"}
      className="inline-flex items-center gap-0.5 rounded-sm border border-destructive/50 bg-destructive/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-destructive"
    >
      <CircleAlert className="h-2.5 w-2.5" />
      not json
    </span>
  );
}

export interface MiniPin {
  icon: ElementType;
  label: string;
  value: string;
  emphasis?: "default" | "primary" | "muted";
}

export function MiniPinRow({ pins }: { pins: MiniPin[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {pins.map(({ icon: Icon, label, value, emphasis = "default" }) => (
        <span
          key={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono tabular-nums",
            emphasis === "primary"
              ? "border-primary/50 bg-primary/10 text-primary"
              : emphasis === "muted"
                ? "border-border/40 bg-muted/30 text-muted-foreground"
                : "border-border/60 bg-card/40",
          )}
        >
          <Icon className="h-2.5 w-2.5" />
          <span className="opacity-70 uppercase tracking-wider">{label}</span>
          <span className="font-semibold">{value}</span>
        </span>
      ))}
    </div>
  );
}
