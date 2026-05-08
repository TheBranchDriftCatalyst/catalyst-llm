import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared keyboard-navigation primitive for popover-style listbox UIs (the
 * three model selectors, and any future dropdown). Encapsulates:
 *
 *  - Arrow Up/Down — move active index, wrapping at the ends
 *  - Home/End      — jump to first/last item
 *  - Enter/Space   — invoke the active item
 *  - Escape        — close the popover (caller handles)
 *  - Active row scrolls into view automatically
 *
 * The hook is intentionally headless: it tracks an active index and exposes
 * an `onKeyDown` plus a `getItemProps(index)` builder. Consumers wire those
 * into whatever DOM they want (button rows, table rows, anything).
 */
export interface UseListboxKeyboardOptions {
  /** Total number of selectable items (post-filter). */
  itemCount: number;
  /** Whether the popover is open — keyboard handlers no-op when false. */
  open: boolean;
  /** Called with the active index when the user invokes Enter/Space. */
  onSelect: (index: number) => void;
  /** Called when Escape is pressed. */
  onEscape?: () => void;
  /**
   * Optional initial active index when the popover opens. Default 0; pass
   * a function to compute lazily (e.g. "highlight the currently selected
   * item if any, else 0").
   */
  initialIndex?: number | (() => number);
}

export interface UseListboxKeyboardResult {
  /** Index of the currently keyboard-highlighted item, or -1 if none. */
  activeIndex: number;
  /** Imperative setter — useful for resetting on filter change. */
  setActiveIndex: (i: number) => void;
  /** Spread onto the input or container that should receive arrow keys. */
  keyboardProps: {
    onKeyDown: (e: React.KeyboardEvent) => void;
  };
  /**
   * Spread onto each item element to wire `data-active`, scroll-into-view,
   * and ARIA option semantics. Item element should also have `role="option"`
   * and the listbox container `role="listbox"`.
   */
  getItemProps: (index: number) => {
    ref: (el: HTMLElement | null) => void;
    "data-active": boolean | undefined;
    "aria-selected": boolean;
    id: string;
    role: "option";
  };
  /** Spread onto the listbox container. */
  listboxProps: {
    role: "listbox";
    id: string;
    "aria-activedescendant": string | undefined;
  };
}

let _idCounter = 0;
function uniqueListboxId() {
  _idCounter += 1;
  return `catalyst-llm-listbox-${_idCounter}`;
}

export function useListboxKeyboard({
  itemCount,
  open,
  onSelect,
  onEscape,
  initialIndex = 0,
}: UseListboxKeyboardOptions): UseListboxKeyboardResult {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const idRef = useRef<string>(uniqueListboxId());
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Reset to initialIndex whenever the popover opens.
  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    const start =
      typeof initialIndex === "function" ? initialIndex() : initialIndex;
    setActiveIndex(Math.max(0, Math.min(start, itemCount - 1)));
    // Intentionally not depending on initialIndex — only re-fire on open
    // transitions and itemCount churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clamp when the filtered list shrinks below the active index.
  useEffect(() => {
    if (activeIndex >= itemCount) {
      setActiveIndex(itemCount > 0 ? itemCount - 1 : -1);
    }
  }, [itemCount, activeIndex]);

  // Scroll the active row into view as the user arrows around.
  useEffect(() => {
    const el = itemRefs.current.get(activeIndex);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % Math.max(itemCount, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) =>
            (i - 1 + Math.max(itemCount, 1)) % Math.max(itemCount, 1),
          );
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(itemCount - 1);
          break;
        case "Enter":
        case " ": {
          if (activeIndex >= 0 && activeIndex < itemCount) {
            e.preventDefault();
            onSelect(activeIndex);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          onEscape?.();
          break;
      }
    },
    [open, itemCount, activeIndex, onSelect, onEscape],
  );

  const getItemProps = useCallback(
    (index: number) => ({
      ref: (el: HTMLElement | null) => {
        if (el) itemRefs.current.set(index, el);
        else itemRefs.current.delete(index);
      },
      "data-active": index === activeIndex || undefined,
      "aria-selected": index === activeIndex,
      id: `${idRef.current}-opt-${index}`,
      role: "option" as const,
    }),
    [activeIndex],
  );

  const activeId =
    activeIndex >= 0 ? `${idRef.current}-opt-${activeIndex}` : undefined;

  return {
    activeIndex,
    setActiveIndex,
    keyboardProps: { onKeyDown },
    getItemProps,
    listboxProps: {
      role: "listbox" as const,
      id: idRef.current,
      "aria-activedescendant": activeId,
    },
  };
}
