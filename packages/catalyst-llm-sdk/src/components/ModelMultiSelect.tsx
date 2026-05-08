import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Search,
  X,
  Monitor,
  Server,
  Cloud,
} from "lucide-react";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import type { ModelWithRouting, EndpointType } from "../client/index.js";
import { useModels } from "../react/hooks.js";
import { fuzzyFilter } from "./fuzzy.js";
import { useListboxKeyboard } from "./useListboxKeyboard.js";
import { useFocusTrap } from "./useFocusTrap.js";
import { cn } from "./utils.js";

const ICON_FOR: Record<EndpointType, React.ElementType> = {
  mac: Monitor,
  cluster: Server,
  cloud: Cloud,
};

interface Group {
  key: EndpointType;
  label: string;
  models: ModelWithRouting[];
}

export interface ModelMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Optional placeholder text when nothing is selected. */
  placeholder?: string;
  className?: string;
  /** Cap on selectable count; UI prevents adding past it. */
  max?: number;
}

/**
 * Compact multi-select for model IDs. Designed for the comparison page where
 * users routinely pick 2–10 models — supports fuzzy filter, click-to-toggle,
 * shift-click range select within the filtered view, and per-group "select
 * all" actions. Stays open across selections.
 */
export function ModelMultiSelect({
  value,
  onChange,
  placeholder = "Select models…",
  className,
  max,
}: ModelMultiSelectProps) {
  const { grouped, models } = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClickedRef = useRef<string | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  // Mirror `value` into a ref. We update the ref synchronously inside our
  // `commit` helper so multiple toggles in a single tick (programmatic tests,
  // shift+click range) see the running selection — without this, each handler
  // reads the same stale closure value and all but the last click is lost.
  const valueRef = useRef(value);
  valueRef.current = value;

  function commit(next: string[]) {
    valueRef.current = next;
    onChange(next);
  }

  const groups: Group[] = useMemo(
    () =>
      [
        { key: "mac" as const, label: "Local (Mac)", models: grouped.mac },
        { key: "cluster" as const, label: "Cluster", models: grouped.cluster },
        { key: "cloud" as const, label: "Cloud", models: grouped.cloud },
      ]
        .map((g) => ({
          ...g,
          models: fuzzyFilter(g.models, query, (m) => m.id),
        }))
        .filter((g) => g.models.length > 0),
    [grouped, query],
  );

  // Flat ordered list (matches what's visible) so shift-click range works.
  const flatVisible = useMemo(() => groups.flatMap((g) => g.models), [groups]);

  const atMax = typeof max === "number" && value.length >= max;

  const popoverRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popoverRef, open);

  const { keyboardProps, getItemProps, listboxProps } = useListboxKeyboard({
    itemCount: flatVisible.length,
    open,
    onSelect: (i) => {
      const m = flatVisible[i];
      if (m) {
        toggle(m.id);
        lastClickedRef.current = m.id;
      }
    },
    onEscape: () => setOpen(false),
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  function freshSet() {
    return new Set(valueRef.current);
  }

  function toggle(id: string, additive = true) {
    const next = freshSet();
    if (next.has(id)) next.delete(id);
    else if (!atMax || next.has(id)) next.add(id);
    commit(Array.from(additive ? next : new Set([id])));
  }

  function rangeSelect(toId: string) {
    const fromId = lastClickedRef.current;
    const cur = freshSet();
    if (!fromId) {
      toggle(toId);
      return;
    }
    const fromIdx = flatVisible.findIndex((m) => m.id === fromId);
    const toIdx = flatVisible.findIndex((m) => m.id === toId);
    if (fromIdx === -1 || toIdx === -1) {
      toggle(toId);
      return;
    }
    const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    const ids = flatVisible.slice(lo, hi + 1).map((m) => m.id);
    // Treat whether `from` is currently selected as the operation: if it's
    // selected, the range should add; otherwise the range should remove.
    const isAdd = cur.has(fromId);
    for (const id of ids) {
      if (isAdd) {
        if (!atMax || cur.has(id)) cur.add(id);
      } else {
        cur.delete(id);
      }
    }
    commit(Array.from(cur));
  }

  function selectGroup(g: Group, mode: "all" | "none") {
    const next = freshSet();
    for (const m of g.models) {
      if (mode === "all") {
        if (!atMax || next.has(m.id)) next.add(m.id);
      } else {
        next.delete(m.id);
      }
    }
    commit(Array.from(next));
  }

  function selectAll() {
    const next = freshSet();
    for (const m of flatVisible) {
      if (!atMax || next.has(m.id)) next.add(m.id);
    }
    commit(Array.from(next));
  }

  function clearAll() {
    commit([]);
  }

  function invertVisible() {
    const next = freshSet();
    for (const m of flatVisible) {
      if (next.has(m.id)) next.delete(m.id);
      else if (!atMax || next.has(m.id)) next.add(m.id);
    }
    commit(Array.from(next));
  }

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          value.length === 0
            ? placeholder
            : `Models selected: ${value.length}${max ? ` of ${max}` : ""}`
        }
        onClick={() => setOpen((o) => !o)}
        className="h-8"
      >
        <span className="font-mono text-xs">
          {value.length === 0
            ? placeholder
            : `${value.length} selected${max ? ` / ${max}` : ""}`}
        </span>
        <ChevronsUpDown className="ml-1.5 h-3 w-3 opacity-60" aria-hidden="true" />
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1 w-[420px] overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={keyboardProps.onKeyDown}
              placeholder="Filter models…"
              aria-label="Filter models"
              aria-controls={listboxProps.id}
              aria-activedescendant={listboxProps["aria-activedescendant"]}
              className="flex-1 bg-transparent text-sm focus-visible:outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5 text-[10px]">
            <button
              type="button"
              onClick={selectAll}
              className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              all
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              none
            </button>
            <button
              type="button"
              onClick={invertVisible}
              className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              invert
            </button>
            <span className="ml-auto text-muted-foreground/70">
              {value.length} selected · click to toggle · shift+click for range
            </span>
          </div>

          <div {...listboxProps} className="max-h-[420px] overflow-y-auto">
            {groups.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                no models match "{query}"
              </div>
            )}
            {(() => {
              let runningIndex = 0;
              return groups.map((g) => {
                const Icon = ICON_FOR[g.key];
                const groupSelected = g.models.every((m) => selected.has(m.id));
                return (
                  <div key={g.key}>
                    <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5 text-[10px]">
                      <Icon className="h-3 w-3 text-primary" aria-hidden="true" />
                      <span className="font-bold uppercase tracking-wider text-muted-foreground">
                        {g.label}
                      </span>
                      <span className="opacity-60">({g.models.length})</span>
                      <div className="ml-auto flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            selectGroup(g, groupSelected ? "none" : "all")
                          }
                          className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider hover:bg-accent/40 hover:text-foreground"
                        >
                          {groupSelected ? "deselect group" : "select group"}
                        </button>
                      </div>
                    </div>
                    {g.models.map((m) => {
                      const idx = runningIndex++;
                      const itemProps = getItemProps(idx);
                      const checked = selected.has(m.id);
                      const cost = m.metadata?.input_cost_per_token;
                      return (
                        <button
                          {...itemProps}
                          ref={(el) => itemProps.ref(el)}
                          key={m.id}
                          type="button"
                          aria-checked={checked}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              rangeSelect(m.id);
                            } else {
                              toggle(m.id);
                            }
                            lastClickedRef.current = m.id;
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                            "hover:bg-accent/30",
                            "data-[active=true]:bg-accent/60 data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-primary/40",
                            checked && "bg-primary/10 text-primary",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                              checked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background",
                            )}
                            aria-hidden="true"
                          >
                            {checked && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className="flex-1 truncate font-mono">{m.id}</span>
                          {cost ? (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              ${(cost * 1_000_000).toFixed(2)}/M
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-sm bg-primary/15 px-1 text-[9px] font-bold uppercase text-primary">
                              free
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>

          {atMax && (
            <div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-[10px] text-destructive">
              max of {max} reached — deselect to add more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
