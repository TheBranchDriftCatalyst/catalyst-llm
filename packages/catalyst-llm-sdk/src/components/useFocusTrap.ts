import { useEffect, useRef } from "react";

/**
 * Trap keyboard focus inside a container while it's active. Tab cycles
 * between the first and last focusable elements; Shift+Tab wraps backward.
 * Used by modal dialogs and dropdown popovers so keyboard users can't
 * accidentally tab into the (visually inaccessible) page behind.
 *
 * Usage:
 *
 *   const ref = useRef(null);
 *   useFocusTrap(ref, open);
 *   return <div ref={ref} role="dialog">…</div>;
 *
 * When `active` flips true the first focusable child receives focus.
 * When it flips false the previously-focused element is restored.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    previouslyFocused.current = document.activeElement;

    // Move focus to the first focusable element inside the trap.
    const focusables = ref.current.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR,
    );
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // No focusable children — make the container itself focusable so we
      // don't lose focus to <body>.
      ref.current.tabIndex = -1;
      ref.current.focus();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("data-focus-trap-skip"));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever had it before we trapped.
      const prev = previouslyFocused.current;
      if (prev instanceof HTMLElement && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [active, ref]);
}
