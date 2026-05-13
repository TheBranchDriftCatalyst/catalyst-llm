/**
 * Controlled prompt edit form: metadata grid + system/user body
 * editors + header action strip (save / discard / dup / delete /
 * .prompt.md export). Owns no state of its own beyond a Cmd-S
 * handler.
 *
 * Also hosts the canonical PromptDraft type + projection helpers
 * (EMPTY_PROMPT_DRAFT, presetToDraft, draftToPayload) — the form's
 * state shape, so the data + the form travel together.
 */
import { useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Download,
  Sparkles,
  Wand2,
  Save,
  X,
  Tag,
  RotateCcw,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import type { CustomPreset } from "../react/promptStore.js";
import { cn } from "./utils.js";
import { CATEGORY_META } from "./prompt-picker-list.js";

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
