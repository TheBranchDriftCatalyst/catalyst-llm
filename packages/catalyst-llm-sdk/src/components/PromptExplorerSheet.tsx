/**
 * PromptExplorerSheet — the right-side Sheet body for the Engine tab.
 *
 * Operator clicks the prompt-icon button on a node's inline config; the
 * Engine tab flips `sheetContext.kind === "prompt"` and renders this
 * inside the open `<SheetContent>`. The sheet itself (wrapper, header)
 * lives in EngineView so we can share it with the runs sheet (T6).
 *
 * Three stacked sections:
 *
 *   1. Binding controls — only when a node is bound to a preset OR has
 *      a raw inline `system_prompt` override. Clear binding + show /
 *      edit the inline override textarea.
 *
 *   2. Picker — `<PromptPickerList>` filtered to presets eligible for
 *      a system slot (category `system` or `both`), grouped by
 *      domain → purpose. Clicking a row writes
 *      `system_prompt_ref = preset.id` and closes the sheet.
 *
 *   3. Edit-bound — collapsible `<PromptEditForm>` for the bound
 *      preset. Save patches the PromptStore directly; the node's
 *      binding (system_prompt_ref) is untouched, so the next chat
 *      dispatch picks up the new content.
 *
 * DRY notes: the picker list and edit form are both extracted out of
 * PromptEditor.tsx, so the standalone Prompts tab and this sheet share
 * the same row visuals, filter semantics, and save plumbing.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  X as XIcon,
} from "lucide-react";
import { useEngineStore } from "../react/engineStore.js";
import { usePromptStore } from "../react/promptStore.js";
import {
  EMPTY_PROMPT_DRAFT,
  PromptEditForm,
  PromptPickerList,
  draftToPayload,
  presetToDraft,
  type PromptDraft,
} from "./PromptEditor.js";
import { cn } from "./utils.js";

export interface PromptExplorerSheetProps {
  agentId: string;
  /** The node (= per-Pydantic-config bucket) whose `system_prompt_ref`
   * and `system_prompt` overrides we're editing. */
  nodeId: string;
  /** Close the sheet — invoked after picking a preset so the operator
   * sees the binding land immediately on the node card. */
  onClose: () => void;
  className?: string;
}

export function PromptExplorerSheet({
  agentId,
  nodeId,
  onClose,
  className,
}: PromptExplorerSheetProps) {
  const presets = usePromptStore((s) => s.presets);
  const updatePreset = usePromptStore((s) => s.updatePreset);

  const setField = useEngineStore((s) => s.setField);
  const boundRef = useEngineStore(
    (s) => s.configs[agentId]?.[nodeId]?.system_prompt_ref as string | undefined,
  );
  const inlineOverride = useEngineStore(
    (s) => s.configs[agentId]?.[nodeId]?.system_prompt as string | undefined,
  );

  const bound = useMemo(
    () => (boundRef ? presets.find((p) => p.id === boundRef) : undefined),
    [presets, boundRef],
  );

  // Picker filter — local to this sheet instance; resets every time the
  // sheet remounts (i.e. you reopen it on a different node).
  const [filter, setFilter] = useState("");

  // Only system-ish presets are candidates for binding to system_prompt.
  const systemPresets = useMemo(
    () => presets.filter((p) => p.category === "system" || p.category === "both"),
    [presets],
  );

  // ── Inline override editor ──────────────────────────────────────────
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [inlineDraft, setInlineDraft] = useState(inlineOverride ?? "");
  // Re-sync when the underlying value changes (e.g. another tab cleared
  // the override). Effects nicely on remount too.
  useEffect(() => {
    setInlineDraft(inlineOverride ?? "");
  }, [inlineOverride, agentId, nodeId]);

  const inlineDirty = inlineDraft !== (inlineOverride ?? "");

  function saveInlineOverride() {
    const next = inlineDraft.trim();
    setField(agentId, nodeId, "system_prompt", next ? inlineDraft : undefined);
  }
  function clearInlineOverride() {
    setField(agentId, nodeId, "system_prompt", undefined);
    setInlineEditOpen(false);
  }

  // ── Edit-bound form ────────────────────────────────────────────────
  // Collapsible — the picker is the primary action, the editor is a
  // power-user affordance.
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [editDirty, setEditDirty] = useState(false);

  // Whenever the bound preset (or its underlying content) changes, reset
  // the editor draft to mirror it — except don't blow away unsaved
  // changes mid-edit.
  useEffect(() => {
    if (editDirty) return;
    setEditDraft(bound ? presetToDraft(bound) : EMPTY_PROMPT_DRAFT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bound?.id, bound?.updatedAt]);

  function setEditField<K extends keyof PromptDraft>(k: K, v: PromptDraft[K]) {
    setEditDraft((d) => ({ ...d, [k]: v }));
    setEditDirty(true);
  }
  function saveBoundPreset() {
    if (!bound) return;
    updatePreset(bound.id, draftToPayload(editDraft));
    setEditDirty(false);
  }
  function discardBoundEdit() {
    if (!bound) return;
    setEditDraft(presetToDraft(bound));
    setEditDirty(false);
  }

  // ── Picker click ───────────────────────────────────────────────────
  function pickPreset(id: string) {
    setField(agentId, nodeId, "system_prompt_ref", id);
    onClose();
  }
  function clearBinding() {
    setField(agentId, nodeId, "system_prompt_ref", undefined);
  }

  // ── Header summary line ────────────────────────────────────────────
  const summary = bound
    ? `currently bound: ${bound.name}`
    : inlineOverride
      ? "currently bound: (inline override)"
      : "currently bound: (none)";

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-[11px] text-muted-foreground">
        {summary}
      </div>

      {/* ── Section 1 — Binding controls ─────────────────────────── */}
      {(bound || inlineOverride !== undefined) && (
        <section className="space-y-2 rounded-md border border-border/60 bg-card/30 p-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Pencil className="h-3 w-3" aria-hidden="true" />
            binding
          </div>
          <div className="flex flex-wrap gap-1.5">
            {bound && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearBinding}
                className="text-[10px]"
                title="Unbind this node from its saved prompt"
              >
                <XIcon className="mr-1 h-3 w-3" />
                clear binding
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setInlineEditOpen((v) => !v)}
              className="text-[10px]"
            >
              {inlineEditOpen ? (
                <ChevronDown className="mr-1 h-3 w-3" />
              ) : (
                <ChevronRight className="mr-1 h-3 w-3" />
              )}
              {inlineOverride !== undefined
                ? "edit inline override"
                : "set inline override"}
            </Button>
            {inlineOverride !== undefined && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearInlineOverride}
                className="text-[10px] text-destructive hover:bg-destructive/10"
                title="Remove the raw system_prompt override"
              >
                <XIcon className="mr-1 h-3 w-3" />
                clear override
              </Button>
            )}
          </div>
          {inlineEditOpen && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Raw system_prompt override
              </Label>
              <Textarea
                value={inlineDraft}
                onChange={(e) => setInlineDraft(e.target.value)}
                placeholder="Type a one-off system prompt for this node…"
                className="min-h-[120px] resize-y font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setInlineDraft(inlineOverride ?? "")}
                  disabled={!inlineDirty}
                  className="text-[10px]"
                >
                  discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={saveInlineOverride}
                  disabled={!inlineDirty}
                  className="text-[10px]"
                >
                  save override
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Section 2 — Pick a saved prompt ──────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/60 bg-card/30">
        <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          pick a saved prompt
          <span className="opacity-60">({systemPresets.length})</span>
        </div>
        <PromptPickerList
          presets={systemPresets}
          filter={filter}
          onFilterChange={setFilter}
          selectedId={boundRef ?? null}
          onSelect={pickPreset}
          groupBy="domain"
          emptyState={
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              <p className="mb-2">No system prompts saved yet.</p>
              <p className="text-[10px] leading-relaxed">
                Visit the <span className="font-mono">Prompts</span> tab to
                create one. Set its category to "System prompt" or "Bundle"
                and it'll show up here.
              </p>
            </div>
          }
          className="flex-1 min-h-0"
        />
      </section>

      {/* ── Section 3 — Edit the bound preset ─────────────────────── */}
      {bound && (
        <section className="rounded-md border border-border/60 bg-card/30">
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
          >
            {editOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            edit this prompt
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] normal-case text-muted-foreground/80">
              <ExternalLink className="h-3 w-3" />
              {bound.name}
            </span>
          </button>
          {editOpen && (
            <div className="max-h-[480px] overflow-y-auto">
              <PromptEditForm
                draft={editDraft}
                dirty={editDirty}
                isNew={false}
                onField={setEditField}
                onSave={saveBoundPreset}
                onDiscard={discardBoundEdit}
                headerLabel="edit bound prompt"
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
