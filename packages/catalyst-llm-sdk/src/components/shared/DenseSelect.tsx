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

export interface DenseSelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Optional muted sub-line under the label (e.g., model provider). */
  description?: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Disable this option. */
  disabled?: boolean;
}

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
}

const POPOVER_MIN_W = 160;

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
}: DenseSelectProps<V>) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // Position the popover under the trigger when opened. Re-measure on
  // scroll/resize so it sticks even when an ancestor moves.
  useEffect(() => {
    if (!open) return;
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
    const selIdx = options.findIndex((o) => o.value === value);
    if (selIdx >= 0) {
      setFocusIndex(selIdx);
    } else {
      const firstEnabled = options.findIndex((o) => !o.disabled);
      setFocusIndex(firstEnabled >= 0 ? firstEnabled : 0);
    }
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, options, value]);

  // Close on click outside (trigger + popover both count as inside).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

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
        // nothing remains, stay put.
        const start = i < 0 ? -1 : i;
        for (let j = start + 1; j < options.length; j++) {
          if (!options[j]?.disabled) return j;
        }
        return i;
      });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => {
        const start = i < 0 ? options.length : i;
        for (let j = start - 1; j >= 0; j--) {
          if (!options[j]?.disabled) return j;
        }
        return i;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[focusIndex];
      // Disabled rows (separators) MUST NOT be selectable via Enter.
      if (opt && !opt.disabled) pick(opt);
    }
  }

  const popover = open && rect ? (
    <div
      ref={popoverRef}
      role="listbox"
      aria-labelledby={`${id}-trigger`}
      // DS-C1: explicit hairline ring + shadow so the popover visually
      // separates from sibling controls beneath in narrow rails. The
      // `pointer-events-auto` ensures clicks land here, not on whatever
      // sits underneath in the same stacking context.
      className={cn(
        "fixed z-50 rounded-sm border border-border/30 bg-background/95 backdrop-blur-sm",
        "ring-1 ring-border/30 shadow-lg shadow-background/40 pointer-events-auto",
        "py-0.5 font-mono text-[10.5px]",
        "max-h-[280px] overflow-y-auto",
        popoverClassName,
      )}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
      }}
    >
      {options.length === 0 && (
        <div className="px-2 py-1 text-muted-foreground italic">no options</div>
      )}
      {options.map((opt, i) => {
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
            <span className="flex-1 min-w-0 truncate">{opt.label}</span>
            {isSelected && (
              <span className="shrink-0 text-primary text-[10px]">✓</span>
            )}
            {opt.description && (
              <span className="shrink-0 text-[9px] text-muted-foreground/70 truncate max-w-[40%]">
                {opt.description}
              </span>
            )}
          </button>
        );
      })}
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
        {selected?.icon && (
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
