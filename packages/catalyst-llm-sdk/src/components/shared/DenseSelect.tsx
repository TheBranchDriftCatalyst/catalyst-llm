/**
 * DenseSelect — terminal-aesthetic dropdown replacing native <select>.
 *
 * Native selects can't be themed (the option list is browser-rendered).
 * This component is a drop-in replacement that:
 *   - looks flat + monospace by default
 *   - opens a popover-rendered option list under the trigger
 *   - keyboard-navigates with ↑/↓/Enter/Esc
 *   - keeps narrow rail surfaces tight
 *
 * Used across SDK (prompt edit form, engine inline config) and the
 * operator (workspace, beads, engine routes).
 *
 * Generic over the option value (string by default).
 *
 *   <DenseSelect
 *     value={mode}
 *     onChange={setMode}
 *     options={[
 *       { value: 'a', label: 'A' },
 *       { value: 'b', label: 'B' },
 *     ]}
 *     placeholder="pick one"
 *   />
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "./utils.js";
import { fuzzyFilter } from "./fuzzy.js";

export interface DenseSelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Optional muted sub-line under the label (e.g., model provider). */
  description?: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Disable this option. */
  disabled?: boolean;
  /** DS-PRO4: mark this option as recently used (rendered with a small
   *  orange dot before the label). Call-site is responsible for the
   *  recency rule (e.g. touched <24h, run_count > 0). */
  recent?: boolean;
}

/** DS-PRO6: threshold above which the popover renders a fuzzy filter
 *  input. Below this the option count fits in working memory and a
 *  filter would be ceremony. */
const FILTER_THRESHOLD = 10;

export interface DenseSelectProps<V extends string = string> {
  value: V | undefined;
  onChange: (next: V) => void;
  options: ReadonlyArray<DenseSelectOption<V>>;
  /** Shown when value is undefined / not in options. */
  placeholder?: string;
  /** Whole component disabled. */
  disabled?: boolean;
  /** Accessibility label for the trigger. */
  ariaLabel?: string;
  /** Class on the wrapper. */
  className?: string;
  /** Class on the trigger button itself (override colors, padding,
   *  borders for badge-style usage). */
  triggerClassName?: string;
  /** Class on the popover (override max-h, w, etc). */
  popoverClassName?: string;
  /** Render the popover into document.body so it escapes ancestor
   *  transforms / overflow clipping. Default true. */
  portal?: boolean;
  /** DS-P8: optional leading icon rendered before the label inside the
   *  trigger button (independent of any per-option icons). Use for
   *  surfaces where the picker itself carries a context glyph (e.g. a
   *  folder icon on the workspace picker). */
  triggerIcon?: ReactNode;
}

const POPOVER_MIN_W = 160;

// DS-P6: module-scoped registry of open DenseSelect close handlers.
// Each instance registers its `setOpen(false)` closer under its useId
// when it opens; opening any instance first calls every OTHER registered
// closer, then registers itself. This guarantees only one DenseSelect
// popover can be visible at a time across the entire app.
const OPEN_INSTANCES = new Map<string, () => void>();

function closeOtherInstances(selfId: string) {
  for (const [id, close] of OPEN_INSTANCES) {
    if (id === selfId) continue;
    try {
      close();
    } catch {
      /* swallow — closer may have been unmounted between registration
         and call; the unmount-effect cleanup handles eviction. */
    }
  }
}

export function DenseSelect<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = "select",
  disabled = false,
  ariaLabel,
  className,
  triggerClassName,
  popoverClassName,
  portal = true,
  triggerIcon,
}: DenseSelectProps<V>) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  // DS-PRO6: filter query is popover-local — resets on close so the
  // next open starts with the full list.
  const [filterQuery, setFilterQuery] = useState("");

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // DS-PRO6: filter input renders only when options.length > threshold.
  const filterEnabled = options.length > FILTER_THRESHOLD;

  // DS-PRO6: derive the rendered option list from the query. Disabled
  // separator rows are kept verbatim (they're presentational and don't
  // participate in the fuzzy match) — but only if at least one
  // selectable option after them survives the filter; otherwise we'd
  // strand orphan headers. Strategy: fuzzy-filter the selectable rows
  // only, then walk the original list and emit each separator only when
  // a selectable row that follows it (before the next separator)
  // survived. Cheap enough at typical option counts.
  const renderedOptions = useMemo(() => {
    if (!filterEnabled || !filterQuery.trim()) return options;
    const getText = (o: DenseSelectOption<V>) =>
      typeof o.label === "string" ? o.label : String(o.value);
    const matchedSet = new Set(
      fuzzyFilter(
        options.filter((o) => !o.disabled),
        filterQuery,
        getText,
      ),
    );
    // Walk forward, emit separators only if followed by at least one
    // surviving option before the next separator.
    const tmp: DenseSelectOption<V>[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (opt.disabled) {
        // Peek ahead — keep the separator only if at least one
        // selectable surviving option exists before the next separator.
        let keep = false;
        for (let j = i + 1; j < options.length; j++) {
          if (options[j].disabled) break;
          if (matchedSet.has(options[j])) {
            keep = true;
            break;
          }
        }
        if (keep) tmp.push(opt);
      } else if (matchedSet.has(opt)) {
        tmp.push(opt);
      }
    }
    return tmp as unknown as typeof options;
  }, [options, filterEnabled, filterQuery]);

  // Position the popover under the trigger when opened. Re-measure on
  // scroll/resize so it sticks even when an ancestor moves.
  useEffect(() => {
    if (!open) {
      // DS-PRO6: clear the query on close so the next open is fresh.
      setFilterQuery("");
      return;
    }
    const measure = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, POPOVER_MIN_W),
      });
    };
    measure();
    // Prefer the currently-selected option; fall back to the first
    // non-disabled option so separators don't get initial focus.
    const selIdx = renderedOptions.findIndex((o) => o.value === value);
    if (selIdx >= 0) {
      setFocusIndex(selIdx);
    } else {
      const firstEnabled = renderedOptions.findIndex((o) => !o.disabled);
      setFocusIndex(firstEnabled >= 0 ? firstEnabled : 0);
    }
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, renderedOptions, value]);

  // DS-PRO6: autofocus the filter input when the popover opens (and
  // the filter is enabled). Effect fires after the popover mounts.
  useEffect(() => {
    if (!open || !filterEnabled) return;
    // Schedule on next tick so the input has actually mounted via the
    // portal before we try to focus it.
    const t = setTimeout(() => filterInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, filterEnabled]);

  // DS-PRO6: when the filter query narrows the list, the previously
  // focused index can land on a now-stranded position. Re-clamp to the
  // first selectable row whenever renderedOptions length changes.
  useEffect(() => {
    if (!open) return;
    if (focusIndex >= 0 && focusIndex < renderedOptions.length) {
      const cur = renderedOptions[focusIndex];
      if (cur && !cur.disabled) return;
    }
    const first = renderedOptions.findIndex((o) => !o.disabled);
    setFocusIndex(first);
    // We intentionally exclude focusIndex from deps — including it
    // would cause the clamp to fight every ArrowDown keypress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, renderedOptions]);

  // Close on click outside (trigger + popover both count as inside).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      // DS-P7: click-outside closes but intentionally does NOT restore
      // focus to the trigger — the user clicked away, so refocusing the
      // trigger would yank focus away from whatever they actually
      // wanted to interact with.
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // DS-P6: register this instance's closer while open, and evict any
  // OTHER currently-open instance. Cleanup deregisters on close /
  // unmount so the registry can never accumulate stale closers.
  useEffect(() => {
    if (!open) {
      OPEN_INSTANCES.delete(id);
      return;
    }
    closeOtherInstances(id);
    OPEN_INSTANCES.set(id, () => setOpen(false));
    return () => {
      OPEN_INSTANCES.delete(id);
    };
  }, [open, id]);

  function pick(opt: DenseSelectOption<V>) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => {
        // Skip disabled options (e.g. separator rows like `── projects ──`)
        // by walking forward until we land on a selectable index. If
        // nothing remains, stay put. DS-PRO6: walks renderedOptions so
        // filtered-out rows are skipped automatically (they're not in
        // the list at all).
        const start = i < 0 ? -1 : i;
        for (let j = start + 1; j < renderedOptions.length; j++) {
          if (!renderedOptions[j]?.disabled) return j;
        }
        return i;
      });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => {
        const start = i < 0 ? renderedOptions.length : i;
        for (let j = start - 1; j >= 0; j--) {
          if (!renderedOptions[j]?.disabled) return j;
        }
        return i;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = renderedOptions[focusIndex];
      // Disabled rows (separators) MUST NOT be selectable via Enter.
      if (opt && !opt.disabled) pick(opt);
    }
  }

  // DS-PRO10: count selectable (non-separator) rows for the stats
  // footer. Filtering changes this on the fly so the footer reflects
  // what the user is actually looking at.
  const selectableCount = useMemo(
    () => renderedOptions.filter((o) => !o.disabled).length,
    [renderedOptions],
  );

  const popover = open && rect ? (
    <div
      ref={popoverRef}
      role="listbox"
      aria-labelledby={`${id}-trigger`}
      data-testid="dense-select-popover"
      // DS-C1: explicit hairline ring + shadow so the popover visually
      // separates from sibling controls beneath in narrow rails. The
      // `pointer-events-auto` ensures clicks land here, not on whatever
      // sits underneath in the same stacking context.
      className={cn(
        "fixed z-50 rounded-sm border border-border/30 bg-background/95 backdrop-blur-sm",
        "ring-1 ring-border/30 shadow-lg shadow-background/40 pointer-events-auto",
        "font-mono text-[10.5px] overflow-hidden",
        // DS-PRO6: filter input + DS-PRO10 footer turn this into a 3-row
        // grid (filter | scrollable list | footer). Use flex column with
        // the list as the only scrollable region so filter/footer stay
        // pinned at the edges.
        "flex flex-col",
        "max-h-[320px]",
        popoverClassName,
      )}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
      }}
    >
      {/* DS-PRO6: fuzzy filter input — only rendered when there are
          enough options to justify it. Autofocused on open. Typing
          narrows the list; arrow keys still navigate (handler is bound
          on the wrapper, so the input doesn't intercept them). */}
      {filterEnabled && (
        <div className="border-b border-border/15 px-1.5 py-1 shrink-0">
          <input
            ref={filterInputRef}
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="filter…"
            data-testid="dense-select-filter"
            className={cn(
              "w-full bg-transparent outline-none",
              "font-mono text-[10.5px] text-foreground",
              "placeholder:text-muted-foreground/50",
            )}
            // Stop Space from toggling the popover via the wrapper's
            // keydown handler — the input needs Space to type.
            onKeyDown={(e) => {
              if (e.key === " ") e.stopPropagation();
            }}
          />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-0.5">
      {renderedOptions.length === 0 && (
        <div className="px-2 py-1 text-muted-foreground italic">no options</div>
      )}
      {renderedOptions.map((opt, i) => {
        const isSelected = opt.value === value;
        const isFocused = i === focusIndex && !opt.disabled;

        // DS-C2: separator / disabled rows render as presentational <li>s.
        // They're not arrow-navigable (skipped in onKeyDown), not
        // clickable (pointer-events-none), and visually distinct (smaller
        // uppercase text + a hairline rule above).
        if (opt.disabled) {
          return (
            <li
              key={String(opt.value)}
              role="presentation"
              className={cn(
                "block w-full px-2 py-1 text-left flex items-center gap-1.5",
                "pointer-events-none select-none",
                "text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground/70",
                // Hairline rule above to visually group the section.
                "border-t border-border/15 mt-1 pt-1",
              )}
            >
              {opt.icon && (
                <span className="shrink-0 inline-flex items-center">
                  {opt.icon}
                </span>
              )}
              <span className="flex-1 min-w-0 truncate">{opt.label}</span>
            </li>
          );
        }

        // DS-C3: composable focused / selected states.
        //   Selected → left primary border accent + ✓ + text-primary
        //   Focused  → bg-muted/40 + outline-1 outline-primary/30
        //   Both    → all of the above compose
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => pick(opt)}
            onMouseEnter={() => setFocusIndex(i)}
            className={cn(
              "block w-full px-2 py-1 text-left flex items-center gap-1.5 transition-colors",
              // Reserve the left border width even when not selected so
              // rows don't shift horizontally on selection.
              "border-l-2 border-transparent",
              "text-foreground",
              isFocused &&
                "bg-muted/40 outline outline-1 outline-primary/30 -outline-offset-1",
              isSelected && "border-l-2 border-primary text-primary",
            )}
          >
            {opt.icon && (
              <span className="shrink-0 inline-flex items-center text-primary">
                {opt.icon}
              </span>
            )}
            {/* DS-PRO4: tiny orange dot for recently-touched options.
                Sits to the left of the label so it's visible even when
                a long label triggers the truncate ellipsis. */}
            {opt.recent && (
              <span
                aria-hidden="true"
                data-testid="dense-select-recent-dot"
                className="shrink-0 text-[9px] leading-none text-orange-400"
                title="recent"
              >
                ●
              </span>
            )}
            {/* DS-P3: label gets flex-1 + min-w-0 + truncate so a long
                label collapses to an ellipsis instead of wrapping or
                pushing the description off-screen. */}
            <span className="flex-1 min-w-0 truncate">{opt.label}</span>
            {isSelected && (
              <span className="shrink-0 text-primary text-[10px]">✓</span>
            )}
            {opt.description && (
              // DS-P3: description is capped at 40% of the row width,
              // tabular-nums so numeric metadata (counts, dates) line up
              // visually, shrink-0 so it never gets squashed by a long
              // label (which is the one that should ellipsise instead).
              <span className="shrink-0 tabular-nums max-w-[40%] truncate text-[9px] text-muted-foreground/70">
                {opt.description}
              </span>
            )}
          </button>
        );
      })}
      </div>
      {/* DS-PRO10: mini-stats footer — count of selectable rows currently
          visible. Reflects the filtered list so the user sees how much
          they've narrowed. Same tiny uppercase tracking as separators
          for visual cohesion. */}
      <div
        data-testid="dense-select-stats-footer"
        className={cn(
          "shrink-0 border-t border-border/15 px-2 py-1",
          "text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground/60",
        )}
      >
        {selectableCount} {selectableCount === 1 ? "option" : "options"}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={cn("relative inline-block", className)}
      onKeyDown={onKeyDown}
    >
      <button
        id={`${id}-trigger`}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid="dense-select-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10.5px] font-mono",
          "text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:text-primary",
          disabled && "opacity-40 cursor-not-allowed hover:text-foreground",
          "w-full",
          triggerClassName,
        )}
      >
        {/* DS-P8: static leading icon for the trigger itself — distinct
            from per-option icons, which only apply when an option is
            selected. Useful for surfaces where the picker carries a
            persistent context glyph (e.g. workspace = folder icon). */}
        {triggerIcon && (
          <span className="shrink-0 inline-flex items-center text-primary">
            {triggerIcon}
          </span>
        )}
        {!triggerIcon && selected?.icon && (
          <span className="shrink-0 inline-flex items-center text-primary">
            {selected.icon}
          </span>
        )}
        <span className="flex-1 min-w-0 truncate text-left">
          {selected ? selected.label : <span className="text-muted-foreground/70">{placeholder}</span>}
        </span>
        {/* Single ChevronDown at 60% opacity — the previous ChevronsUpDown
            glyph read like a number-spinner control rather than a dropdown
            affordance. */}
        <ChevronDown className="h-2.5 w-2.5 opacity-60 shrink-0" aria-hidden="true" />
      </button>
      {portal && popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : popover}
    </div>
  );
}
