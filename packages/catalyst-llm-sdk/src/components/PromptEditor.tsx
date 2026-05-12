import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Search,
  Sparkles,
  Wand2,
  Save,
  X,
  Download,
  Upload,
  Tag,
  User,
  Shield,
  Layers,
  RotateCcw,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import {
  usePromptStore,
  type CustomPreset,
} from "../react/promptStore.js";
import {
  parsePromptFile,
  serializePromptFile,
} from "../react/promptFile.js";
import { BUILTIN_SEEDS } from "./PromptPresets.js";
import { cn } from "./utils.js";

export interface PromptEditorProps {
  className?: string;
  /** When provided, the editor opens with this preset selected. */
  initialPresetId?: string;
}

/**
 * Shape of the form state held by {@link PromptEditForm}. Exposed so
 * embedders (e.g. PromptExplorerSheet) can hold drafts in their own
 * state if they don't want to share the editor's state machine.
 */
export type PromptDraft = {
  name: string;
  description: string;
  category: "user" | "system" | "both";
  systemPrompt: string;
  user: string;
  modelPattern: string;
  tags: string;
  /** Semantic axis (e.g. "research", "chat", "code"). Optional. */
  domain: string;
  /** Functional purpose within the domain (e.g. "system", "critique",
   * "synthesis"). Optional. */
  purpose: string;
};

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  name: "",
  description: "",
  category: "user",
  systemPrompt: "",
  user: "",
  modelPattern: "",
  tags: "",
  domain: "",
  purpose: "",
};

/** Project a {@link CustomPreset} into a {@link PromptDraft}. */
export function presetToDraft(p: CustomPreset): PromptDraft {
  return {
    name: p.name,
    description: p.description ?? "",
    category: p.category,
    systemPrompt: p.systemPrompt ?? "",
    user: p.user ?? "",
    modelPattern: p.modelPattern ?? "",
    tags: (p.tags ?? []).join(", "),
    domain: p.domain ?? "",
    purpose: p.purpose ?? "",
  };
}

/** Project a {@link PromptDraft} into the persisted patch payload. */
export function draftToPayload(
  draft: PromptDraft,
): Omit<CustomPreset, "id" | "createdAt" | "updatedAt"> {
  const cleanTags = draft.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    name: draft.name.trim() || "Untitled",
    description: draft.description.trim() || undefined,
    category: draft.category,
    systemPrompt:
      draft.category === "user" ? undefined : draft.systemPrompt || undefined,
    user:
      draft.category === "system" ? undefined : draft.user || undefined,
    modelPattern: draft.modelPattern.trim() || undefined,
    tags: cleanTags.length ? cleanTags : undefined,
    domain: draft.domain.trim() || undefined,
    purpose: draft.purpose.trim() || undefined,
  };
}

const CATEGORY_META = {
  user: { label: "User prompt", Icon: User, hint: "Pre-fills the chat textarea" },
  system: { label: "System prompt", Icon: Shield, hint: "Sets the chat's system role" },
  both: { label: "Bundle", Icon: Layers, hint: "Applies system + user together" },
} as const;

const UNFILED_LABEL = "(unfiled)";

/** Test-only export for sibling files (PromptExplorerSheet) that want
 * to reuse the same row visual without re-implementing it. */
export { PresetRow };

/**
 * Two-pane prompt registry editor: list on the left, form on the right.
 *
 * Storage: backed by {@link usePromptStore}, persisted to localStorage as
 * `catalyst-llm-sdk:prompts`. A successful Save inserts via `addPreset`
 * (new) or `updatePreset` (existing); the right pane re-syncs when the
 * left selection changes via a generation counter (so unsaved edits
 * don't leak between rows).
 *
 * Import/export: round-trips the registry as JSON. Import is "merge"
 * by default — existing ids win so a re-import never clobbers user
 * edits. Hold Shift while clicking Import to do a full replace.
 */
export function PromptEditor({ className, initialPresetId }: PromptEditorProps) {
  const presets = usePromptStore((s) => s.presets);
  const addPreset = usePromptStore((s) => s.addPreset);
  const updatePreset = usePromptStore((s) => s.updatePreset);
  const removePreset = usePromptStore((s) => s.removePreset);
  const duplicatePreset = usePromptStore((s) => s.duplicatePreset);
  const exportJson = usePromptStore((s) => s.exportJson);
  const importJson = usePromptStore((s) => s.importJson);
  const resetBuiltins = usePromptStore((s) => s.resetBuiltins);

  // Cheap heuristic — if the file starts with `{` or `[` we treat it
  // as JSON regardless of extension. Stops a JSON file with a `.prompt`
  // suffix from getting misrouted through the frontmatter parser.
  const looksLikeJson = (s: string) => {
    const t = s.trimStart();
    return t.startsWith("{") || t.startsWith("[");
  };

  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPresetId ?? presets[0]?.id ?? null,
  );
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-load the form whenever the selected row changes. We also use
  // `selectedId` as the key for an effect dependency so a rapid
  // selection swap doesn't strand half-loaded state.
  useEffect(() => {
    if (!selectedId) {
      setDraft(EMPTY_PROMPT_DRAFT);
      setDirty(false);
      return;
    }
    const p = presets.find((x) => x.id === selectedId);
    if (!p) {
      // Selection went stale (deleted) — fall back to first row
      setSelectedId(presets[0]?.id ?? null);
      return;
    }
    setDraft(presetToDraft(p));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function setField<K extends keyof PromptDraft>(k: K, v: PromptDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  }

  function newPreset() {
    setSelectedId(null);
    setDraft({ ...EMPTY_PROMPT_DRAFT, name: "Untitled prompt" });
    setDirty(true);
  }

  function save() {
    const payload = draftToPayload(draft);
    if (selectedId) {
      updatePreset(selectedId, payload);
    } else {
      const id = addPreset(payload);
      setSelectedId(id);
    }
    setDirty(false);
  }

  function discard() {
    if (selectedId) {
      // Re-trigger the load effect by toggling selection
      const id = selectedId;
      setSelectedId(null);
      requestAnimationFrame(() => setSelectedId(id));
    } else {
      setDraft(EMPTY_PROMPT_DRAFT);
      setDirty(false);
    }
  }

  function downloadExport() {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalyst-llm-prompts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport(replace: boolean) {
    const input = fileInputRef.current;
    if (!input) return;
    input.dataset.replace = replace ? "1" : "";
    input.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const replace = e.target.dataset.replace === "1";

    let imported = 0;
    let failed = 0;
    for (const file of files) {
      const text = await file.text();
      const isPrompt =
        file.name.endsWith(".prompt") ||
        file.name.endsWith(".prompt.md") ||
        // Auto-detect by content — frontmatter delimiter on first line
        text.trimStart().startsWith("---");
      try {
        if (isPrompt && !looksLikeJson(text)) {
          const { preset } = parsePromptFile(text);
          // Round-trip through addPreset so a fresh id + timestamps are
          // assigned. Existing prompts with the same name+category are
          // not deduped here — the store keeps both, and the user can
          // delete the duplicate via the editor.
          addPreset(preset);
          imported += 1;
        } else {
          imported += importJson(text, replace ? "replace" : "merge");
        }
      } catch (err) {
        failed += 1;
        console.error(`[PromptEditor] import of ${file.name} failed:`, err);
      }
    }
    console.info(
      `[PromptEditor] imported ${imported} preset(s) (${replace ? "replace" : "merge"})${failed ? `, ${failed} failed` : ""}`,
    );
    if (failed > 0) {
      window.alert(
        `Import: ${imported} succeeded, ${failed} failed. See console for details.`,
      );
    }
    e.target.value = "";
  }

  function downloadCurrentAsPromptFile() {
    if (!selectedId) return;
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) return;
    const text = serializePromptFile(preset);
    const safeName = preset.name.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName || "prompt"}.prompt.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className={cn(
        "grid h-full grid-cols-[300px_1fr] gap-0 overflow-hidden",
        className,
      )}
    >
      {/* ─── Sidebar ─────────────────────────────────────────────── */}
      <aside className="flex h-full min-h-0 flex-col border-r border-border bg-card/30">
        <div className="flex items-center gap-1 border-b border-border bg-muted/20 p-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            prompts ({presets.length})
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={newPreset}
            title="New prompt"
            aria-label="New prompt"
            className="ml-auto"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <PromptPickerList
          presets={presets}
          filter={filter}
          onFilterChange={setFilter}
          selectedId={selectedId}
          dirtySelectedId={dirty ? selectedId : null}
          onSelect={setSelectedId}
          groupBy="category"
          emptyState={
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              <p className="mb-2">No prompts yet.</p>
              <Button type="button" size="sm" variant="outline" onClick={newPreset}>
                <Plus className="mr-1 h-3 w-3" />
                Create the first one
              </Button>
            </div>
          }
          className="flex-1 min-h-0"
        />

        <div className="flex items-center gap-1 border-t border-border bg-muted/20 p-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={downloadExport}
            disabled={presets.length === 0}
            title="Download all prompts as JSON"
            className="text-[10px]"
          >
            <Download className="mr-1 h-3 w-3" />
            export
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => triggerImport(e.shiftKey)}
            title="Import JSON · shift+click to replace existing"
            className="text-[10px]"
          >
            <Upload className="mr-1 h-3 w-3" />
            import
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (
                window.confirm(
                  "Reset all built-in presets to their shipped defaults?\n\n" +
                    "Your edits to built-ins will be lost. User-created presets are not affected.",
                )
              ) {
                const n = resetBuiltins(BUILTIN_SEEDS);
                console.info(`[PromptEditor] reset ${n} built-in preset(s)`);
              }
            }}
            title="Reset built-in presets to their shipped defaults"
            className="ml-auto text-[10px]"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            reset
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,.prompt,.prompt.md,.md,text/markdown"
            multiple
            className="hidden"
            onChange={onImportFile}
          />
        </div>
      </aside>

      {/* ─── Editor ──────────────────────────────────────────────── */}
      <section className="flex h-full min-h-0 flex-col overflow-hidden">
        {!selectedId && !dirty ? (
          <EmptyState onCreate={newPreset} />
        ) : (
          <PromptEditForm
            draft={draft}
            dirty={dirty}
            onField={setField}
            onSave={save}
            onDiscard={discard}
            onDelete={
              selectedId
                ? () => {
                    if (window.confirm(`Delete prompt "${draft.name}"?`)) {
                      removePreset(selectedId);
                      setSelectedId(presets.find((p) => p.id !== selectedId)?.id ?? null);
                    }
                  }
                : undefined
            }
            onDuplicate={
              selectedId
                ? () => {
                    const newId = duplicatePreset(selectedId);
                    if (newId) setSelectedId(newId);
                  }
                : undefined
            }
            onSaveAsPromptFile={selectedId ? downloadCurrentAsPromptFile : undefined}
            isNew={!selectedId}
          />
        )}
      </section>
    </div>
  );
}

// ─── PromptPickerList ────────────────────────────────────────────────

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

function EmptyState({ onCreate }: { onCreate: () => void }) {
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

// ─── PromptEditForm ──────────────────────────────────────────────────

export interface PromptEditFormProps {
  draft: PromptDraft;
  dirty: boolean;
  isNew: boolean;
  onField: <K extends keyof PromptDraft>(k: K, v: PromptDraft[K]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onSaveAsPromptFile?: () => void;
  /** Optional override for the header tagline — defaults to "new prompt"
   * or "edit prompt" depending on `isNew`. */
  headerLabel?: string;
  className?: string;
}

/**
 * Controlled prompt edit form: metadata grid + system/user body editors
 * + header action strip (save / discard / dup / delete / .prompt.md
 * export). Owns no state of its own beyond a Cmd-S handler.
 */
export function PromptEditForm({
  draft,
  dirty,
  isNew,
  onField,
  onSave,
  onDiscard,
  onDelete,
  onDuplicate,
  onSaveAsPromptFile,
  headerLabel,
  className,
}: PromptEditFormProps) {
  // Cmd/Ctrl-S to save while editing
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty) {
        e.preventDefault();
        onSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onSave]);

  const showSystem = draft.category === "system" || draft.category === "both";
  const showUser = draft.category === "user" || draft.category === "both";

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="flex items-center gap-2 border-b border-border bg-muted/10 px-4 py-2">
        <Wand2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {headerLabel ?? (isNew ? "new prompt" : "edit prompt")}
        </span>
        {dirty && (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
            unsaved
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onDuplicate && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDuplicate}
              title="Duplicate prompt"
              className="text-[10px]"
            >
              <Copy className="mr-1 h-3 w-3" />
              dup
            </Button>
          )}
          {onSaveAsPromptFile && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onSaveAsPromptFile}
              title="Download as .prompt.md (YAML frontmatter + body — the prompts-as-code standard)"
              className="text-[10px]"
            >
              <Download className="mr-1 h-3 w-3" />
              .prompt
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              title="Delete prompt"
              className="text-[10px] text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              delete
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={!dirty}
            title="Discard changes"
            className="text-[10px]"
          >
            <X className="mr-1 h-3 w-3" />
            discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={!dirty || !draft.name.trim()}
            title="Save prompt (⌘S)"
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            save
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 border-b border-border/60 bg-card/20 p-3">
        <div className="space-y-1">
          <Label htmlFor="prompt-name" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Name
          </Label>
          <Input
            id="prompt-name"
            value={draft.name}
            onChange={(e) => onField("name", e.target.value)}
            placeholder="Senior code reviewer"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prompt-cat" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Category
          </Label>
          <select
            id="prompt-cat"
            value={draft.category}
            onChange={(e) => onField("category", e.target.value as PromptDraft["category"])}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>).map((k) => (
              <option key={k} value={k}>
                {CATEGORY_META[k].label} — {CATEGORY_META[k].hint}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="prompt-desc" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Description <span className="text-muted-foreground/60">(shown as tooltip in dropdown)</span>
          </Label>
          <Input
            id="prompt-desc"
            value={draft.description}
            onChange={(e) => onField("description", e.target.value)}
            placeholder="Bugs / security / perf review with line refs."
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prompt-pattern" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Model pattern (regex, optional)
          </Label>
          <Input
            id="prompt-pattern"
            value={draft.modelPattern}
            onChange={(e) => onField("modelPattern", e.target.value)}
            placeholder="^mac/nuextract"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prompt-tags" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tags (comma-separated)
          </Label>
          <Input
            id="prompt-tags"
            value={draft.tags}
            onChange={(e) => onField("tags", e.target.value)}
            placeholder="rp, creative, uncensored"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prompt-domain" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Domain
          </Label>
          <Input
            id="prompt-domain"
            value={draft.domain}
            onChange={(e) => onField("domain", e.target.value)}
            placeholder="research / chat / code / extraction"
            className="h-8 text-xs"
            list="prompt-domain-suggestions"
          />
          <datalist id="prompt-domain-suggestions">
            <option value="research" />
            <option value="chat" />
            <option value="code" />
            <option value="extraction" />
            <option value="vision" />
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor="prompt-purpose" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Purpose
          </Label>
          <Input
            id="prompt-purpose"
            value={draft.purpose}
            onChange={(e) => onField("purpose", e.target.value)}
            placeholder="system / critique / synthesis / summary"
            className="h-8 text-xs"
            list="prompt-purpose-suggestions"
          />
          <datalist id="prompt-purpose-suggestions">
            <option value="system" />
            <option value="critique" />
            <option value="synthesis" />
            <option value="summary" />
            <option value="extraction" />
          </datalist>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {showSystem && (
          <PromptBodyField
            label="System prompt"
            value={draft.systemPrompt}
            onChange={(v) => onField("systemPrompt", v)}
            placeholder={SYSTEM_PLACEHOLDER}
          />
        )}
        {showUser && (
          <PromptBodyField
            label="User prompt"
            value={draft.user}
            onChange={(v) => onField("user", v)}
            placeholder={USER_PLACEHOLDER}
          />
        )}
      </div>
    </div>
  );
}

function PromptBodyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const charCount = value.length;
  return (
    <div className="border-b border-border/30 p-3 last:border-b-0">
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {charCount} chars
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[160px] resize-y font-mono text-xs leading-relaxed"
        spellCheck={false}
      />
    </div>
  );
}

const SYSTEM_PLACEHOLDER = `You are a senior software engineer doing a thorough code review. For any code shown, identify:
1. Bugs and edge cases (null inputs, off-by-one, race conditions).
2. Security concerns (injection, auth, secrets, untrusted input).
3. Performance issues (allocation, N+1, blocking I/O).
…`;

const USER_PLACEHOLDER = `Write a Python function:

def is_balanced(s: str) -> bool

that returns True if every opening bracket in s is closed by a matching closing bracket…`;
