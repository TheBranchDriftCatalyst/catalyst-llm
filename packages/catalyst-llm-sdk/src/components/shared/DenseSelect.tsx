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
  /** DS-PRO2: optional Unix epoch ms of last-touched time. When ANY
   *  option in the list carries this field, the popover renders a
   *  right-aligned relative timestamp ("2h", "yesterday", "3d") in
   *  tabular-nums + opacity-40 and groups are MRU-sorted DESC by this
   *  field (preserving disabled separator order). Call sites attach
   *  this from row-level metadata (e.g. last_active_at, updated_at). */
  recentTs?: number;
}

/** DS-PRO2: format a Unix epoch ms timestamp as a compact relative
 *  string. <60s='now', <60min='Nm', <24h='Nh', <7d='Nd' (with
 *  'yesterday' for the 1d case), else a short date. Used by the right-
 *  rail timestamp affordance inside the popover. */
export function _fmtRelative(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < 60 * SEC) return "now";
  if (diff < 60 * MIN) return `${Math.floor(diff / MIN)}m`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    if (days === 1) return "yesterday";
    return `${days}d`;
  }
  // Fall through to a short ISO date (YYYY-MM-DD).
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "";
  }
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
  /** DS-PRO7: HOST-managed convenience persistence key.
   *
   *  When set, DenseSelect:
   *    - reads `localStorage["dense-select:${persistKey}"]` on first
   *      mount as initial value (ONLY when the controlled `value` prop
   *      is `undefined` — explicit values from the host always win)
   *    - writes the selected value to that same key on every onChange
   *
   *  This is a primitive-level convenience for ephemeral last-selected
   *  state and is intentionally LOSSY: there's no validation that the
   *  persisted value still exists in the current options list.
   *
   *  For canonical URL-state persistence (back/forward, sharable links),
   *  the HOST should use `useUrlState` directly and pass `value` +
   *  `onChange` like any other controlled binding — do NOT use this prop.
   *
   *  DS-PRO9 pin affordance also gates on this key — shift+click only
   *  pins when persistKey is present (pins live at
   *  `localStorage["dense-select-pins:${persistKey}"]`). */
  persistKey?: string;
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
  persistKey,
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

  // DS-PRO9: pinned values for this persistKey instance. JSON array of
  // option values stored at `dense-select-pins:${persistKey}`. Only
  // active when persistKey is set; otherwise pins is a stable empty
  // array (shift+click is a no-op without a persistKey).
  const [pins, setPins] = useState<V[]>(() => {
    if (!persistKey || typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(
        `dense-select-pins:${persistKey}`,
      );
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as V[];
      return [];
    } catch {
      return [];
    }
  });

  // DS-PRO7: hydration of last-selected from localStorage on first
  // mount. Only fires when `value` is undefined (host-supplied values
  // always win) and only when persistKey is set. The hydration calls
  // onChange so the host's state gets the persisted value — DenseSelect
  // itself stays purely controlled.
  //
  // For URL-state persistence (sharable links, back/forward), the host
  // should use `useUrlState` directly and pass value + onChange. This
  // prop is a *convenience* primitive for ephemeral last-selection
  // memory, not a state store.
  const didHydrateRef = useRef(false);
  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;
    if (!persistKey) return;
    if (value !== undefined) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`dense-select:${persistKey}`);
      if (raw == null) return;
      // Stored as a JSON string so empty-string values round-trip.
      const parsed = JSON.parse(raw) as V;
      onChange(parsed);
    } catch {
      /* corrupt entry — ignore */
    }
    // We deliberately only run this on mount; subsequent value changes
    // are host-driven and must not re-hydrate from storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // DS-PRO2: detect whether the caller has tagged any option with a
  // `recentTs`. When true we (a) render right-aligned relative
  // timestamps inline and (b) MRU-sort each group DESC by recentTs,
  // preserving the position of disabled separator rows so groups stay
  // intact.
  const hasRecentTs = useMemo(
    () => options.some((o) => typeof o.recentTs === "number"),
    [options],
  );

  // DS-PRO2 + DS-PRO9: produce the in-popover option list with two
  // transforms applied to the caller's options:
  //
  //   1. MRU-sort options DESC by recentTs WITHIN each group, where a
  //      group is the run of selectable options between disabled
  //      separator rows. Disabled rows keep their original positions
  //      so the user-visible section headers don't reflow.
  //   2. When pins exist (DS-PRO9), prepend a synthetic `── pinned ──`
  //      separator + the pinned options at the top of the list.
  const effectiveOptions = useMemo<ReadonlyArray<DenseSelectOption<V>>>(() => {
    // Step 1 — MRU sort within groups.
    let sorted: DenseSelectOption<V>[] = options.slice();
    if (hasRecentTs) {
      sorted = [];
      let group: DenseSelectOption<V>[] = [];
      const flush = () => {
        group.sort((a, b) => {
          const at = typeof a.recentTs === "number" ? a.recentTs : -Infinity;
          const bt = typeof b.recentTs === "number" ? b.recentTs : -Infinity;
          return bt - at;
        });
        sorted.push(...group);
        group = [];
      };
      for (const opt of options) {
        if (opt.disabled) {
          flush();
          sorted.push(opt);
        } else {
          group.push(opt);
        }
      }
      flush();
    }

    // Step 2 — prepend pinned group when pins exist AND persistKey is
    // active. Pins reference values; we resolve them against the
    // (already MRU-sorted) options and skip any stale entries.
    if (persistKey && pins.length > 0) {
      const byValue = new Map(sorted.map((o) => [o.value, o] as const));
      const pinnedRows = pins
        .map((v) => byValue.get(v))
        .filter((o): o is DenseSelectOption<V> => Boolean(o));
      if (pinnedRows.length > 0) {
        const separator: DenseSelectOption<V> = {
          // Synthetic value — disabled rows aren't selectable so this
          // never collides with a real option value path.
          value: ("__dense-select-pinned-separator__" as unknown) as V,
          label: "── pinned ──",
          disabled: true,
        };
        // Remove pinned values from their original positions so they
        // don't render twice — they'll surface in the pinned group only.
        const pinnedSet = new Set(pins);
        const rest = sorted.filter((o) => !pinnedSet.has(o.value));
        return [separator, ...pinnedRows, ...rest];
      }
    }

    return sorted;
  }, [options, hasRecentTs, persistKey, pins]);

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
    if (!filterEnabled || !filterQuery.trim()) return effectiveOptions;
    const getText = (o: DenseSelectOption<V>) =>
      typeof o.label === "string" ? o.label : String(o.value);
    const matchedSet = new Set(
      fuzzyFilter(
        effectiveOptions.filter((o) => !o.disabled),
        filterQuery,
        getText,
      ),
    );
    // Walk forward, emit separators only if followed by at least one
    // surviving option before the next separator.
    const tmp: DenseSelectOption<V>[] = [];
    for (let i = 0; i < effectiveOptions.length; i++) {
      const opt = effectiveOptions[i];
      if (opt.disabled) {
        // Peek ahead — keep the separator only if at least one
        // selectable surviving option exists before the next separator.
        let keep = false;
        for (let j = i + 1; j < effectiveOptions.length; j++) {
          if (effectiveOptions[j].disabled) break;
          if (matchedSet.has(effectiveOptions[j])) {
            keep = true;
            break;
          }
        }
        if (keep) tmp.push(opt);
      } else if (matchedSet.has(opt)) {
        tmp.push(opt);
      }
    }
    return tmp as unknown as typeof effectiveOptions;
  }, [effectiveOptions, filterEnabled, filterQuery]);

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
    // DS-PRO7: write last-selected to localStorage when persistKey set.
    // We JSON-encode so empty-string values round-trip cleanly and the
    // hydration path can detect "no entry" vs "empty entry".
    if (persistKey && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          `dense-select:${persistKey}`,
          JSON.stringify(opt.value),
        );
      } catch {
        /* quota / disabled storage — swallow */
      }
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  // DS-PRO9: toggle pin status for an option. Shift+click on a row
  // invokes this — when persistKey is set it persists the new pin list
  // immediately. Pinned options render in a synthetic top group.
  function togglePin(optValue: V) {
    if (!persistKey) return;
    setPins((prev) => {
      const isPinned = prev.includes(optValue);
      const next = isPinned
        ? prev.filter((v) => v !== optValue)
        : [...prev, optValue];
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            `dense-select-pins:${persistKey}`,
            JSON.stringify(next),
          );
        } catch {
          /* quota / disabled storage — swallow */
        }
      }
      return next;
    });
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
        const isPinned = !!persistKey && pins.includes(opt.value);

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
            data-pinned={isPinned ? "true" : undefined}
            onClick={(e) => {
              // DS-PRO9: shift+click toggles pin instead of selecting.
              // Only meaningful when persistKey is set — otherwise we
              // have nowhere to persist the pin list.
              if (e.shiftKey && persistKey) {
                e.preventDefault();
                togglePin(opt.value);
                return;
              }
              pick(opt);
            }}
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
            {/* DS-PRO9: 📌 affordance on pinned rows — sits next to the
                recent dot so both metadata glyphs cluster on the left. */}
            {isPinned && (
              <span
                aria-hidden="true"
                data-testid="dense-select-pin-glyph"
                className="shrink-0 text-[9px] leading-none"
                title="pinned (shift+click to unpin)"
              >
                📌
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
            {/* DS-PRO2: right-aligned relative timestamp. Rendered only
                when ANY option in the list carries recentTs (mixed lists
                still get aligned columns because tabular-nums applies
                uniformly). Tabular nums + opacity-40 give a muted
                "metadata column" without competing with the label. */}
            {hasRecentTs && typeof opt.recentTs === "number" && (
              <span
                data-testid="dense-select-relative-ts"
                className="shrink-0 tabular-nums text-[9px] text-foreground opacity-40"
                title={new Date(opt.recentTs).toISOString()}
              >
                {_fmtRelative(opt.recentTs)}
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
      {/* DS-PRO7: hidden span exposing the active persistKey for tests.
          The HOST should use useUrlState directly for URL-state
          persistence; this prop is a convenience for ephemeral
          last-selection memory only. */}
      {persistKey && (
        <span
          data-testid="dense-select-persist"
          data-persist-key={persistKey}
          className="sr-only"
          aria-hidden="true"
        >
          {persistKey}
        </span>
      )}
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
