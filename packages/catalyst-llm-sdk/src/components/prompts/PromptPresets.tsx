import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Shield,
  ChevronDown,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { usePromptStore } from "../../react/promptStore.js";
import { fuzzyFilter } from "../shared/fuzzy.js";
import { useFocusTrap } from "../shared/useFocusTrap.js";
import { useListboxKeyboard } from "../shared/useListboxKeyboard.js";
import { cn } from "../shared/utils.js";
import {
  DEFAULT_PRESETS,
  SYSTEM_PRESETS,
  getPresetsForModel,
  iconForPreset,
  modelSpecUrl,
  type PromptPreset,
} from "./prompt-seeds.js";



export interface PromptPresetsProps {
  presets?: PromptPreset[];
  onApply: (preset: PromptPreset) => void;
  className?: string;
  /** Label rendered before the trigger / chips. Default "presets". */
  label?: string;
  /** Icon next to the label. Default {@link Sparkles}. */
  labelIcon?: React.ElementType;
  /**
   * Layout for the preset row. Default `"dropdown"` (compact trigger that
   * opens a menu of presets with description tooltips). Use `"chips"` if you
   * have horizontal real estate to spare and want one-click application.
   */
  variant?: "dropdown" | "chips";
  /**
   * Optional model id used to filter custom (registry) presets via their
   * `modelPattern`. Built-ins ignore this — the caller already chose them
   * via {@link getPresetsForModel}. Pass `currentChat.model` here.
   */
  modelId?: string;
  /**
   * When true, custom presets from the local registry (saved via
   * {@link PromptEditor}) are merged into the dropdown alongside the
   * built-ins. Defaults to true. Set to false in stories / docs to
   * keep the dropdown deterministic.
   */
  includeCustom?: boolean;
}



export function PromptPresets({
  presets,
  onApply,
  className,
  label = "presets",
  labelIcon: LabelIcon = Sparkles,
  variant = "dropdown",
  modelId,
  includeCustom = true,
}: PromptPresetsProps) {
  // Source of truth is the registry. We subscribe to the stable
  // `presets` slice (NOT the `presetsFor` method, which allocates a
  // new array each call and would trip useSyncExternalStore's
  // "result of getSnapshot should be cached" guard). Filtering by
  // category + modelPattern happens in the useMemo below where the
  // result is referentially cached.
  const customCategory: "user" | "system" =
    label === "system" ? "system" : "user";
  const allCustom = usePromptStore((s) => s.presets);
  const registryPresets = useMemo(() => {
    if (!includeCustom) return [] as Array<PromptPreset>;
    return allCustom
      .filter((p) => {
        if (p.category !== customCategory && p.category !== "both") return false;
        if (!p.modelPattern) return true;
        if (!modelId) return true;
        try {
          return new RegExp(p.modelPattern, "i").test(modelId);
        } catch {
          return true;
        }
      })
      .map<PromptPreset>((p) => ({
        name: p.name,
        description: p.description,
        icon: iconForPreset(p),
        systemPrompt: p.systemPrompt,
        user: p.user,
      }));
  }, [allCustom, customCategory, modelId, includeCustom]);
  // If the caller supplies an explicit `presets` array, it takes
  // priority over the registry — that's the escape hatch for stories
  // / docs / custom hosts that want a deterministic list. Otherwise
  // we render whatever's currently in the registry (which includes
  // built-ins after seedBuiltins runs and any user-saved custom
  // presets matching the current model).
  const mergedPresets = useMemo(
    () => (presets ? presets : registryPresets),
    [presets, registryPresets],
  );
  if (variant === "chips") {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <LabelIcon className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        {mergedPresets.map((p) => {
          const Icon = iconForPreset(p);
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => onApply(p)}
              title={p.description}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium",
                "transition-colors hover:border-primary/60 hover:bg-accent/40 hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3 text-primary" aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <PromptPresetDropdown
      presets={mergedPresets}
      onApply={onApply}
      className={className}
      label={label}
      labelIcon={LabelIcon}
    />
  );
}

function PromptPresetDropdown({
  presets,
  onApply,
  className,
  label,
  labelIcon: LabelIcon,
}: {
  presets: PromptPreset[];
  onApply: (preset: PromptPreset) => void;
  className?: string;
  label: string;
  labelIcon: React.ElementType;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusTrap(popoverRef, open);

  // Fuzzy filter against name + description so a user typing "json" or
  // "code rev" zeroes in fast. Empty query = full list.
  const filtered = useMemo(
    () =>
      fuzzyFilter(
        presets,
        query,
        (p) => `${p.name} ${p.description ?? ""}`,
      ),
    [presets, query],
  );

  function pick(p: PromptPreset) {
    onApply(p);
    setOpen(false);
    setQuery("");
  }

  const { keyboardProps, getItemProps, listboxProps } = useListboxKeyboard({
    itemCount: filtered.length,
    open,
    onSelect: (i) => pick(filtered[i]),
    onEscape: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus search on open + reset query when closing.
  useEffect(() => {
    if (open) {
      setQuery("");
      // Defer focus to next tick so the input is mounted.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative inline-block", className)}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Apply a ${label} preset`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium",
          "transition-colors hover:border-primary/60 hover:bg-accent/40 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "border-primary/60 bg-accent/40",
        )}
      >
        <LabelIcon className="h-3 w-3 text-primary" aria-hidden="true" />
        <span className="uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
        >
          {/* Searchable header — auto-focused, fuzzy-filters by name + description. */}
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={keyboardProps.onKeyDown}
              placeholder={`Filter ${label}…`}
              aria-label={`Filter ${label} presets`}
              aria-controls={listboxProps.id}
              aria-activedescendant={listboxProps["aria-activedescendant"]}
              className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                title="Clear filter"
                aria-label="Clear filter"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            {...listboxProps}
            className="max-h-80 overflow-y-auto p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[10px] text-muted-foreground">
                No prompts match "{query}"
              </div>
            )}
            {filtered.map((p, i) => {
              const Icon = iconForPreset(p);
              const itemProps = getItemProps(i);
              const specHref = modelSpecUrl(p.modelPattern);
              return (
                <div
                  {...itemProps}
                  ref={(el: HTMLElement | null) => itemProps.ref(el)}
                  key={`${p.name}-${i}`}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                    "hover:bg-accent/40 hover:text-foreground transition-colors",
                    "data-[active=true]:bg-accent/60 data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-primary/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    title={p.description}
                    className="flex flex-1 min-w-0 items-start gap-2 text-left"
                  >
                    <Icon
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {p.name}
                        {p.modelPattern && (
                          <span
                            className="ml-1.5 inline-block rounded-sm bg-primary/15 px-1 text-[8px] font-bold uppercase text-primary align-middle"
                            title={`Scoped to models matching /${p.modelPattern}/i`}
                          >
                            model-specific
                          </span>
                        )}
                      </span>
                      {p.description && (
                        <span className="block text-[10px] leading-snug text-muted-foreground">
                          {p.description}
                        </span>
                      )}
                    </span>
                  </button>
                  {specHref && (
                    <a
                      href={specHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`Open model spec for /${p.modelPattern}/`}
                      aria-label="Open model spec on Hugging Face"
                      className="mt-0.5 shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model-specific preset selection
// ---------------------------------------------------------------------------
// Specialized models (NuExtract template extraction, UniversalNER zero-shot
// NER, etc.) carry their own input shape. Rather than hardcoding a separate
// bundle per model, we use the `modelPattern` regex on each registry entry:
// when a preset's pattern matches the current model id, that preset is the
// preferred dropdown item for that model. Pure built-ins (no pattern) act
// as the universal fallback.
//
// Hosts that want to know whether the dropdown is *currently* showing a
// model-specific bundle (e.g. to swap the row's chrome to a "NUEXTRACT"
// label) call getPresetsForModel(modelId) below.
// ---------------------------------------------------------------------------

export interface SystemPromptPresetsProps {
  /** Called with the chosen preset — wire to set your system prompt slot. */
  onApply: (preset: PromptPreset) => void;
  presets?: PromptPreset[];
  className?: string;
  /** See {@link PromptPresetsProps.variant}. Defaults to `"dropdown"`. */
  variant?: "dropdown" | "chips";
  /** See {@link PromptPresetsProps.modelId}. */
  modelId?: string;
  /** See {@link PromptPresetsProps.includeCustom}. Defaults to true. */
  includeCustom?: boolean;
}

/**
 * Thin convenience wrapper around {@link PromptPresets} pre-loaded with
 * {@link SYSTEM_PRESETS} and a "system" label. Use next to a system-prompt
 * textarea; the preset's `systemPrompt` is what you'll typically apply.
 */
export function SystemPromptPresets({
  onApply,
  presets = SYSTEM_PRESETS,
  className,
  variant,
  modelId,
  includeCustom,
}: SystemPromptPresetsProps) {
  return (
    <PromptPresets
      presets={presets}
      onApply={onApply}
      className={className}
      label="system"
      labelIcon={Shield}
      variant={variant}
      modelId={modelId}
      includeCustom={includeCustom}
    />
  );
}
