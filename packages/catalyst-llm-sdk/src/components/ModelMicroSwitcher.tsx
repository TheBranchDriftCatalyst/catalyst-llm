import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown, Monitor, Server, Cloud } from "lucide-react";
import type { ModelWithRouting, EndpointType } from "../client/index.js";
import { useModels } from "../react/hooks.js";
import { fuzzyFilter } from "./fuzzy.js";
import { useListboxKeyboard } from "./useListboxKeyboard.js";
import { useFocusTrap } from "./useFocusTrap.js";
import { cn } from "./utils.js";

export interface ModelMicroSwitcherProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const ICON_FOR: Record<EndpointType, React.ElementType> = {
  mac: Monitor,
  cluster: Server,
  cloud: Cloud,
};

/**
 * Compact inline model swap. Designed for header chrome / message-row UIs
 * where space is at a premium — the trigger is a single chip showing the
 * current model id, the popover is a flat fuzzy-filtered list (no rich
 * cards). Pair with {@link ModelSelectorRich} when full metadata matters.
 */
export function ModelMicroSwitcher({
  value,
  onChange,
  className,
}: ModelMicroSwitcherProps) {
  const { models } = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Viewport-anchored popover position. Recomputed every open + on
  // scroll/resize so the popover stays under the trigger even when
  // an ancestor (e.g. a reactflow canvas) repositions. The popover
  // is rendered into a document.body portal so it escapes the
  // reactflow per-node stacking context that was clipping it behind
  // sibling nodes.
  const [popoverRect, setPopoverRect] = useState<{
    top: number;
    right: number;
    width: number;
  } | null>(null);
  const POPOVER_W = 288; // matches w-72 below

  const selected = models.find((m) => m.id === value);
  const SelectedIcon = selected ? ICON_FOR[selected.endpoint?.type ?? "cloud"] : Cloud;

  const filtered = useMemo(
    () => fuzzyFilter(models, query, (m) => m.id),
    [models, query],
  );

  const popoverRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popoverRef, open);

  // Highlight the currently selected row by default if it's in the filter
  // result; otherwise the first row.
  const initialIndex = () => {
    const idx = filtered.findIndex((m) => m.id === value);
    return idx >= 0 ? idx : 0;
  };

  function pick(modelId: string) {
    onChange(modelId);
    setOpen(false);
    setQuery("");
  }

  const { keyboardProps, getItemProps, listboxProps } = useListboxKeyboard({
    itemCount: filtered.length,
    open,
    onSelect: (i) => pick(filtered[i].id),
    onEscape: () => setOpen(false),
    initialIndex,
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Measure trigger position whenever the popover opens, on viewport
  // resize, and on any ancestor scroll (capture-phase). Without
  // recomputing on scroll, panning in a reactflow canvas would leave
  // the popover stranded at its initial coordinates.
  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPopoverRect({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
        width: POPOVER_W,
      });
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      // Click inside the trigger wrapper OR inside the portalled
      // popover should not close. Use refs for both since the
      // popover lives outside wrapRef's DOM subtree.
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const popover = open && popoverRect && (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        top: popoverRect.top,
        right: popoverRect.right,
        width: popoverRect.width,
        // Inline z-index is a redundant belt-and-suspenders with the
        // portal — z-50 already wins because the portal lives at the
        // document.body level outside any stacking context.
        zIndex: 1000,
      }}
      className="overflow-hidden rounded-md border border-border bg-background shadow-2xl"
    >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={keyboardProps.onKeyDown}
            placeholder="Filter…"
            aria-label="Filter models"
            aria-controls={listboxProps.id}
            aria-activedescendant={listboxProps["aria-activedescendant"]}
            className={cn(
              "w-full border-b border-border bg-transparent px-3 py-2 text-xs",
              "focus-visible:outline-none placeholder:text-muted-foreground",
            )}
          />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={keyboardProps.onKeyDown}
        placeholder="Filter…"
        aria-label="Filter models"
        aria-controls={listboxProps.id}
        aria-activedescendant={listboxProps["aria-activedescendant"]}
        className={cn(
          "w-full border-b border-border bg-transparent px-3 py-2 text-xs",
          "focus-visible:outline-none placeholder:text-muted-foreground",
        )}
      />
      <div className="max-h-72 overflow-y-auto" {...listboxProps}>
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            no match
          </div>
        )}
        {filtered.map((m, i) => {
          const Icon = ICON_FOR[m.endpoint?.type ?? "cloud"];
          const itemProps = getItemProps(i);
          return (
            <button
              {...itemProps}
              ref={(el) => itemProps.ref(el)}
              key={m.id}
              type="button"
              onClick={() => pick(m.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40",
                "data-[active=true]:bg-accent/60 data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-primary/40",
                m.id === value && "bg-primary/10 text-primary",
              )}
            >
              <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
              <span className="flex-1 truncate font-mono">{m.id}</span>
              {m.metadata?.input_cost_per_token ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ${(m.metadata.input_cost_per_token * 1_000_000).toFixed(2)}/M
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
    </div>
  );

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          selected ? `Switch model (currently ${selected.id})` : "Select a model"
        }
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-xs font-mono",
          "hover:border-primary/60 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <SelectedIcon className="h-3 w-3 text-primary" aria-hidden="true" />
        <span className="max-w-[180px] truncate">
          {selected?.id ?? "select model"}
        </span>
        <ChevronsUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
      {/* Portal the popover so it escapes any ancestor stacking
       * context (reactflow nodes set `transform`, which creates a
       * new context and clips child popovers behind sibling nodes).
       * SSR guard: only call createPortal in the browser. */}
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
}
