import { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, Monitor, Server, Cloud, X } from "lucide-react";
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input";
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";
import type { ModelWithRouting } from "../../client/index.js";
import { useModels } from "../../react/hooks.js";
import { ModelInfoCard } from "./ModelInfoCard.js";
import { fuzzyFilter } from "../fuzzy.js";
import { useListboxKeyboard } from "../useListboxKeyboard.js";
import { useFocusTrap } from "../useFocusTrap.js";
import { cn } from "../utils.js";

export interface ModelSelectorRichProps {
  value: string;
  onChange: (value: string) => void;
  /** Persist the dropdown open between selections (useful in stories/demos). */
  defaultOpen?: boolean;
}

const GROUP_ICON = {
  mac: Monitor,
  cluster: Server,
  cloud: Cloud,
} as const;

interface Group {
  key: "mac" | "cluster" | "cloud";
  label: string;
  models: ModelWithRouting[];
}

/**
 * Searchable model picker. Combines a fuzzy-search input with grouped, rich
 * dropdown items rendered via {@link ModelInfoCard}. Each item shows pricing,
 * context window, and capability badges so the operator picks with full
 * context, not just by name.
 */
export function ModelSelectorRich({
  value,
  onChange,
  defaultOpen = false,
}: ModelSelectorRichProps) {
  const { grouped, models, loading, error, refresh } = useModels();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(
    () => models.find((m) => m.id === value),
    [models, value],
  );

  const filtered: Group[] = useMemo(() => {
    const groups: Group[] = [
      { key: "mac", label: "Local (Mac)", models: grouped.mac },
      { key: "cluster", label: "Cluster", models: grouped.cluster },
      { key: "cloud", label: "Cloud", models: grouped.cloud },
    ];
    return groups
      .map((g) => ({
        ...g,
        models: fuzzyFilter(g.models, query, (m) =>
          `${m.id} ${m.metadata?.litellm_provider ?? ""} ${m.metadata?.description ?? ""}`,
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [grouped, query]);

  // Flat list of items in render-order so the keyboard nav can walk the
  // grouped popover with a single index.
  const flatItems = useMemo(
    () => filtered.flatMap((g) => g.models),
    [filtered],
  );

  useFocusTrap(popoverRef, open);

  function pick(modelId: string) {
    onChange(modelId);
    setOpen(false);
    setQuery("");
  }

  const initialIndex = () => {
    const idx = flatItems.findIndex((m) => m.id === value);
    return idx >= 0 ? idx : 0;
  };

  const { keyboardProps, getItemProps, listboxProps } = useListboxKeyboard({
    itemCount: flatItems.length,
    open,
    onSelect: (i) => pick(flatItems[i].id),
    onEscape: () => setOpen(false),
    initialIndex,
  });

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Model (rich)</Label>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          title="Refresh models"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={
            selected ? `Selected model: ${selected.id}` : "Select a model"
          }
          onClick={() => setOpen((o) => !o)}
          disabled={loading}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm",
            "hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="truncate font-mono">
            {selected?.id ?? (loading ? "Loading models…" : "Select a model")}
          </span>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>

        {open && (
          <div
            ref={popoverRef}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[480px] overflow-hidden rounded-md border border-border bg-popover shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={keyboardProps.onKeyDown}
                placeholder="Search models, providers, capabilities…"
                aria-controls={listboxProps.id}
                aria-activedescendant={listboxProps["aria-activedescendant"]}
                className="h-7 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  title="Clear"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              {...listboxProps}
              className="max-h-[420px] overflow-y-auto p-1.5"
            >
              {filtered.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No models match "{query}"
                </div>
              )}
              {(() => {
                let runningIndex = 0;
                return filtered.map((g) => {
                  const Icon = GROUP_ICON[g.key];
                  return (
                    <div key={g.key} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {g.label}
                        <span className="opacity-60">({g.models.length})</span>
                      </div>
                      <div className="space-y-1">
                        {g.models.map((m) => {
                          const idx = runningIndex++;
                          const itemProps = getItemProps(idx);
                          return (
                            <button
                              {...itemProps}
                              ref={(el) => itemProps.ref(el)}
                              key={m.id}
                              type="button"
                              onClick={() => pick(m.id)}
                              className={cn(
                                "block w-full text-left transition-colors",
                                "rounded-md ring-1 ring-transparent hover:ring-primary/40",
                                "data-[active=true]:ring-primary/60 data-[active=true]:bg-accent/30",
                                m.id === value && "ring-primary/70",
                              )}
                            >
                              <ModelInfoCard model={m} compact />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
