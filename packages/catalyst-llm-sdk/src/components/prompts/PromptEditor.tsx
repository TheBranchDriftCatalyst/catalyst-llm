import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Download, Upload, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { usePromptStore } from "../../react/promptStore.js";
import {
  parsePromptFile,
  serializePromptFile,
} from "../../react/promptFile.js";
import { BUILTIN_SEEDS } from "./prompt-seeds.js";
import { cn } from "../shared/utils.js";
import { PromptPickerList, EmptyState } from "./prompt-picker-list.js";
import {
  EMPTY_PROMPT_DRAFT,
  PromptEditForm,
  draftToPayload,
  presetToDraft,
  type PromptDraft,
} from "./prompt-edit-form.js";

export interface PromptEditorProps {
  className?: string;
  /** When provided, the editor opens with this preset selected. */
  initialPresetId?: string;
}
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
