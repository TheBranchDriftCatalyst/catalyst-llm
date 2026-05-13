/**
 * PromptExplorerSheet — workbench-style prompt manager for the Engine tab.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 🔍 [ search …             ]  [+ New]                           │  shrink-0
 *   │ ┌──┐ ┌────┐ ┌──┐ ┌──────┐ ┌──┐  ← horizontal chip picker      │
 *   │ └──┘ └────┘ └──┘ └──────┘ └──┘                                 │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ 🔗 main.agent → bound to: <name>   [bind selected] [clear]     │  shrink-0
 *   ├────────────────────────────────────────────────────────────────┤
 *   │                                                                  │
 *   │   PromptEditForm (the SAME form the standalone Prompts tab uses) │  flex-1
 *   │   filling all remaining vertical space                           │
 *   │                                                                  │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Differs from the first pass (three stacked sections in a narrow Sheet):
 *
 *   - Sheet itself is wider (~50vw) — EnginePage's <SheetContent>
 *     supplies the width.
 *   - Picker is a single search input + a horizontal chip row, not a
 *     vertical grouped list. Bound prompt is highlighted with a ring.
 *   - Edit form fills the remaining height (reuses PromptEditForm from
 *     the standalone Prompts tab — same component, same widgets, same
 *     keyboard shortcuts).
 *   - "Bind selected to <node>" is its own row between picker + form so
 *     the binding action is always visible without scrolling.
 *   - Dropped the inline-system_prompt-override UI — the field still
 *     exists in the data model but isn't surfaced here; saved prompts
 *     are the canonical edit surface. Operators who want a one-off raw
 *     override can still set `system_prompt` directly via the API.
 *
 * DRY notes: PromptEditForm + PromptPickerList primitives were
 * extracted from PromptEditor.tsx in the T8 first pass — both are
 * reused here. New code is mostly the search/chip-row chrome + binding
 * row + state plumbing.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Link2, Plus, Search, X as XIcon } from "lucide-react";
import { useEngineStore } from "../../react/engineStore.js";
import { usePromptStore } from "../../react/promptStore.js";
import {
  EMPTY_PROMPT_DRAFT,
  PromptEditForm,
  draftToPayload,
  presetToDraft,
  type PromptDraft,
} from "./prompt-edit-form.js";
import { cn } from "../utils.js";

export interface PromptExplorerSheetProps {
  agentId: string;
  /** The node (= per-Pydantic-config bucket) whose `system_prompt_ref`
   * binding we're managing. */
  nodeId: string;
  /** Close the sheet. Today the workbench keeps the sheet open even
   * after binding — the operator may keep editing. Pass-through for
   * future affordances (e.g. a close button in the binding row). */
  onClose: () => void;
  className?: string;
}

export function PromptExplorerSheet({
  agentId,
  nodeId,
  onClose: _onClose,
  className,
}: PromptExplorerSheetProps) {
  const presets = usePromptStore((s) => s.presets);
  const addPreset = usePromptStore((s) => s.addPreset);
  const updatePreset = usePromptStore((s) => s.updatePreset);
  const removePreset = usePromptStore((s) => s.removePreset);
  const duplicatePreset = usePromptStore((s) => s.duplicatePreset);

  const setField = useEngineStore((s) => s.setField);
  const boundRef = useEngineStore(
    (s) => s.configs[agentId]?.[nodeId]?.system_prompt_ref as string | undefined,
  );

  // Only system-capable prompts are valid bindings for a system_prompt
  // field. "both" presets fill both slots, so they're included.
  const systemPresets = useMemo(
    () =>
      presets.filter((p) => p.category === "system" || p.category === "both"),
    [presets],
  );

  // Local: what's being viewed/edited (independent of binding).
  // Initial pick: the bound preset → otherwise the first system preset
  // → otherwise null (operator starts on the "new" path).
  const [selectedId, setSelectedId] = useState<string | null>(
    () => boundRef ?? systemPresets[0]?.id ?? null,
  );

  // When the sheet remounts on a different node (or the binding changes
  // out from under us), re-anchor the selection on the bound preset so
  // the operator opens onto the prompt that's currently in use.
  useEffect(() => {
    if (boundRef && selectedId !== boundRef) {
      setSelectedId(boundRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, nodeId, boundRef]);

  const selected = useMemo(
    () => (selectedId ? presets.find((p) => p.id === selectedId) : undefined),
    [presets, selectedId],
  );
  const bound = useMemo(
    () => (boundRef ? presets.find((p) => p.id === boundRef) : undefined),
    [presets, boundRef],
  );

  // Filter input — affects the chip row only; selection persists across
  // filter changes even when the selected chip scrolls out of view.
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return systemPresets;
    return systemPresets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.tags ?? []).join(" ").toLowerCase().includes(q) ||
        (p.domain ?? "").toLowerCase().includes(q) ||
        (p.purpose ?? "").toLowerCase().includes(q),
    );
  }, [systemPresets, filter]);

  // ── Edit-form draft (mirrors PromptEditor's pattern) ────────────────
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [isNewDraft, setIsNewDraft] = useState(false);

  useEffect(() => {
    if (dirty) return; // don't clobber unsaved edits
    if (selected) {
      setDraft(presetToDraft(selected));
      setIsNewDraft(false);
    } else if (!isNewDraft) {
      setDraft(EMPTY_PROMPT_DRAFT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt]);

  function setDraftField<K extends keyof PromptDraft>(k: K, v: PromptDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  }

  function save() {
    const payload = draftToPayload(draft);
    if (selected && !isNewDraft) {
      updatePreset(selected.id, payload);
    } else {
      // Force category to system for fresh prompts created from this
      // sheet — operator's intent is to bind to a system_prompt field,
      // and the picker only surfaces system/both presets.
      const id = addPreset({ ...payload, category: payload.category ?? "system" });
      setSelectedId(id);
      setIsNewDraft(false);
    }
    setDirty(false);
  }

  function discard() {
    if (selected && !isNewDraft) {
      setDraft(presetToDraft(selected));
    } else {
      setDraft(EMPTY_PROMPT_DRAFT);
      setIsNewDraft(false);
      setSelectedId(systemPresets[0]?.id ?? null);
    }
    setDirty(false);
  }

  function newPreset() {
    setSelectedId(null);
    setDraft({
      ...EMPTY_PROMPT_DRAFT,
      name: "New system prompt",
      category: "system",
    });
    setIsNewDraft(true);
    setDirty(true);
  }

  function deleteSelected() {
    if (!selected) return;
    if (boundRef === selected.id) {
      setField(agentId, nodeId, "system_prompt_ref", undefined);
    }
    removePreset(selected.id);
    const remaining = systemPresets.filter((p) => p.id !== selected.id);
    setSelectedId(remaining[0]?.id ?? null);
    setDirty(false);
    setIsNewDraft(false);
  }

  function duplicateSelected() {
    if (!selected) return;
    const newId = duplicatePreset(selected.id);
    if (newId) {
      setSelectedId(newId);
      setDirty(false);
    }
  }

  // ── Binding actions ────────────────────────────────────────────────
  function bindSelected() {
    if (!selectedId) return;
    setField(agentId, nodeId, "system_prompt_ref", selectedId);
  }
  function clearBinding() {
    setField(agentId, nodeId, "system_prompt_ref", undefined);
  }

  const canBindSelected = selectedId && selectedId !== boundRef && !isNewDraft;

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      {/* ── Top: search + chip picker ─────────────────────────────── */}
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search saved prompts (name, description, tags, domain, purpose)…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={newPreset}
            className="h-8 shrink-0 text-xs"
            title="Create a new system prompt"
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
            new
          </Button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto pb-1">
          {filtered.length === 0 ? (
            <span className="px-2 py-1 text-[11px] italic text-muted-foreground">
              {systemPresets.length === 0
                ? "No system prompts saved yet — click 'new' to start."
                : "no match"}
            </span>
          ) : (
            filtered.map((p) => {
              const isSelected = p.id === selectedId && !isNewDraft;
              const isBound = p.id === boundRef;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setIsNewDraft(false);
                  }}
                  title={
                    `${p.name}${p.description ? ` — ${p.description}` : ""}` +
                    (isBound ? " (bound)" : "")
                  }
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                    isSelected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-card/40 hover:bg-card/70",
                    isBound &&
                      !isSelected &&
                      "ring-1 ring-primary/40 ring-offset-1 ring-offset-background",
                  )}
                >
                  {isBound && (
                    <Link2
                      className="h-3 w-3 text-primary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="max-w-[200px] truncate">{p.name}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Middle: binding status + actions ──────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2 truncate">
          <Link2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            <span className="font-mono text-foreground">
              {agentId}.{nodeId}
            </span>{" "}
            bound to:{" "}
            <span
              className={cn(
                "font-medium",
                bound ? "text-foreground" : "italic text-muted-foreground",
              )}
            >
              {bound ? bound.name : "(none)"}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {boundRef && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearBinding}
              className="h-7 text-[11px]"
              title="Unbind this node from its saved prompt"
            >
              <XIcon className="mr-1 h-3 w-3" aria-hidden="true" />
              clear
            </Button>
          )}
          {canBindSelected && (
            <Button
              type="button"
              size="sm"
              onClick={bindSelected}
              className="h-7 text-[11px]"
              title={`Bind ${selected?.name ?? ""} to ${agentId}.${nodeId}`}
            >
              <Link2 className="mr-1 h-3 w-3" aria-hidden="true" />
              bind selected
            </Button>
          )}
        </div>
      </div>

      {/* ── Bottom: edit form fills remaining height ──────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-card/30">
        {selected || isNewDraft ? (
          <PromptEditForm
            draft={draft}
            dirty={dirty}
            isNew={isNewDraft}
            onField={setDraftField}
            onSave={save}
            onDiscard={discard}
            onDelete={selected && !isNewDraft ? deleteSelected : undefined}
            onDuplicate={selected && !isNewDraft ? duplicateSelected : undefined}
            headerLabel={
              isNewDraft
                ? "new prompt"
                : selected
                  ? `editing: ${selected.name}`
                  : "edit prompt"
            }
            className="h-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <div>
              <p className="mb-2">No system prompts to edit yet.</p>
              <p className="text-xs">
                Click <span className="font-mono">new</span> above to create
                one, then bind it to this node.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
