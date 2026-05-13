/**
 * Filterable + grouped preset list. Used by both the Prompts tab
 * (left sidebar — grouped by category) and the Engine tab's prompt
 * sheet (grouped by domain → purpose). The category-grouping output
 * is byte-identical to the pre-extraction sidebar.
 *
 * Owns the small helpers PresetRow, renderByCategory, renderByDomain,
 * EmptyState plus the shared CATEGORY_META / UNFILED_LABEL constants
 * that the form file imports for its category dropdown labels.
 */
import { useMemo } from "react";
import {
  Plus,
  Search,
  Sparkles,
  User,
  Shield,
  Layers,
  Tag,
  Wand2,
} from "lucide-react";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import type { CustomPreset } from "../react/promptStore.js";
import { cn } from "./utils.js";

export const CATEGORY_META = {
  user: { label: "User prompt", Icon: User, hint: "Pre-fills the chat textarea" },
  system: { label: "System prompt", Icon: Shield, hint: "Sets the chat's system role" },
  both: { label: "Bundle", Icon: Layers, hint: "Applies system + user together" },
} as const;

export const UNFILED_LABEL = "(unfiled)";

export type PromptPickerGroupAxis = "category" | "domain";

export interface PromptPickerListProps {
  /** Source list — typically `usePromptStore(s => s.presets)` or a
   * pre-filtered subset (e.g. only `category in ['system','both']`). */
  presets: CustomPreset[];
  /** Free-text filter — matches name/description/tags. Controlled. */
  filter: string;
  onFilterChange: (next: string) => void;
  /** Currently-selected row id (highlighted). */
  selectedId?: string | null;
  /** Id whose row should render a "dirty" dot. Optional. */
  dirtySelectedId?: string | null;
  /** Row click. */
  onSelect: (id: string) => void;
  /**
   * - `"category"` — group by `category` (user / system / both), the
   *   classic Prompts-tab layout.
   * - `"domain"`   — group by `domain` then `purpose`, used by the
   *   PromptExplorerSheet to surface the semantic axes that T7 added.
   *   Presets without a `domain` (or `purpose`) bucket under "(unfiled)".
   */
  groupBy: PromptPickerGroupAxis;
  /** Content shown when the input `presets` array is empty (before
   * filtering). The sidebar uses this to render the "create first
   * prompt" CTA; the sheet uses it to nudge the user to the Prompts
   * tab. */
  emptyState?: React.ReactNode;
  /** Layout passthrough — the parent decides whether the list flexes
   * to fill, has a fixed height, etc. */
  className?: string;
}

/**
 * Filterable + grouped preset list. Used by both the Prompts tab (left
 * sidebar — grouped by category) and the Engine tab's prompt sheet
 * (grouped by domain → purpose). The category-grouping output is
 * byte-identical to the pre-extraction sidebar — that's why the Prompts
 * tab keeps rendering the same way.
 */
export function PromptPickerList({
  presets,
  filter,
  onFilterChange,
  selectedId,
  dirtySelectedId,
  onSelect,
  groupBy,
  emptyState,
  className,
}: PromptPickerListProps) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.tags ?? []).join(" ").toLowerCase().includes(q),
    );
  }, [presets, filter]);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter…"
          className="h-6 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {presets.length === 0 && emptyState}
        {presets.length > 0 && filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            No prompts match "<span className="font-mono">{filter}</span>".
          </div>
        )}
        {groupBy === "category"
          ? renderByCategory(filtered, selectedId, dirtySelectedId, onSelect)
          : renderByDomain(filtered, selectedId, dirtySelectedId, onSelect)}
      </div>
    </div>
  );
}

function renderByCategory(
  filtered: CustomPreset[],
  selectedId: string | null | undefined,
  dirtySelectedId: string | null | undefined,
  onSelect: (id: string) => void,
) {
  const grouped: Record<string, CustomPreset[]> = { user: [], system: [], both: [] };
  for (const p of filtered) (grouped[p.category] ?? []).push(p);

  return (["user", "system", "both"] as const).map((cat) => {
    const rows = grouped[cat];
    if (!rows || rows.length === 0) return null;
    const Meta = CATEGORY_META[cat];
    return (
      <div key={cat} className="mb-2 last:mb-0">
        <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Meta.Icon className="h-3 w-3" aria-hidden="true" />
          {Meta.label}
          <span className="opacity-60">({rows.length})</span>
        </div>
        <div className="space-y-0.5">
          {rows.map((p) => (
            <PresetRow
              key={p.id}
              preset={p}
              active={p.id === selectedId}
              dirty={p.id === dirtySelectedId}
              onSelect={() => onSelect(p.id)}
            />
          ))}
        </div>
      </div>
    );
  });
}

function renderByDomain(
  filtered: CustomPreset[],
  selectedId: string | null | undefined,
  dirtySelectedId: string | null | undefined,
  onSelect: (id: string) => void,
) {
  // domain -> purpose -> rows
  const byDomain = new Map<string, Map<string, CustomPreset[]>>();
  for (const p of filtered) {
    const domain = p.domain?.trim() || UNFILED_LABEL;
    const purpose = p.purpose?.trim() || UNFILED_LABEL;
    if (!byDomain.has(domain)) byDomain.set(domain, new Map());
    const byPurpose = byDomain.get(domain)!;
    if (!byPurpose.has(purpose)) byPurpose.set(purpose, []);
    byPurpose.get(purpose)!.push(p);
  }
  // Stable ordering: alphabetical, with "(unfiled)" buckets sinking to
  // the bottom so the named axes lead.
  const sortKeys = (keys: string[]) =>
    [...keys].sort((a, b) => {
      if (a === UNFILED_LABEL) return 1;
      if (b === UNFILED_LABEL) return -1;
      return a.localeCompare(b);
    });

  const domains = sortKeys([...byDomain.keys()]);
  if (domains.length === 0) return null;

  return domains.map((domain) => {
    const byPurpose = byDomain.get(domain)!;
    const purposes = sortKeys([...byPurpose.keys()]);
    return (
      <div key={domain} className="mb-2 last:mb-0">
        <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Layers className="h-3 w-3" aria-hidden="true" />
          {domain}
        </div>
        {purposes.map((purpose) => {
          const rows = byPurpose.get(purpose)!;
          return (
            <div key={purpose} className="mb-1 pl-2 last:mb-0">
              <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {purpose}
                <span className="opacity-60">({rows.length})</span>
              </div>
              <div className="space-y-0.5">
                {rows.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    active={p.id === selectedId}
                    dirty={p.id === dirtySelectedId}
                    onSelect={() => onSelect(p.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  });
}

function PresetRow({
  preset,
  active,
  dirty,
  onSelect,
}: {
  preset: CustomPreset;
  active: boolean;
  dirty: boolean;
  onSelect: () => void;
}) {
  // CustomPreset no longer carries a React icon (we store iconName as a
  // string for serializability). Defer to a tiny per-name lookup; keep
  // it inline so we don't pull in a Lucide map that overlaps with the
  // dropdown's. Built-ins set iconName; user-saved presets default to
  // the Sparkles fallback.
  const Icon = Sparkles;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs",
        "hover:bg-accent/40 hover:text-foreground transition-colors",
        active && "bg-primary/15 text-primary",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-3 w-3 shrink-0",
          active ? "text-primary" : "text-primary/70",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {preset.name}
          {dirty && <span className="ml-1 text-primary">●</span>}
          {preset.builtin && (
            <span className="ml-1 inline-block rounded-sm bg-primary/15 px-1 text-[8px] font-bold uppercase text-primary align-middle">
              built-in
            </span>
          )}
        </span>
        {preset.description && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {preset.description}
          </span>
        )}
      </span>
      {preset.modelPattern && (
        <Tag
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
          aria-label={`Restricted to models matching /${preset.modelPattern}/i`}
        />
      )}
    </button>
  );
}

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="max-w-sm space-y-3">
        <Wand2 className="mx-auto h-8 w-8 opacity-40" />
        <p className="text-base font-medium text-foreground">Prompt registry</p>
        <p className="text-xs leading-relaxed">
          Save reusable system personas and benchmark user prompts. Pick one
          on the left to edit, or create a new one. Optionally restrict a
          prompt to specific models with a regex (e.g. <code className="rounded bg-muted px-1">^mac/nuextract</code>).
        </p>
        <Button type="button" onClick={onCreate} size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" />
          New prompt
        </Button>
      </div>
    </div>
  );
}
