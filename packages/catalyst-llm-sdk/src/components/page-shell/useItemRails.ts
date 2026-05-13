/**
 * useItemRails — persistent rail-assignment store for SidePanelItems.
 *
 * The hook holds the current `{ left, right, bottom }` ordering of
 * SidePanelItem ids and exposes `moveItem(id, toSide)` to be wired up
 * to each SidePanel's `onItemMove` prop. Order within a rail is the
 * order the operator left them in (drag a left-rail item to the right
 * rail → it appends to the right rail's list).
 *
 * Persistence: one localStorage entry per namespace
 * (`catalyst-llm-sdk:<namespace>:item-rails`). When the stored shape
 * doesn't cover every known item (e.g. the page added a new item id
 * since the user's last visit), we fall back to defaultRails to avoid
 * silently dropping new items. Items that no longer exist in
 * defaultRails are silently dropped from the persisted shape.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Side } from "./sidepanel-internals.js";

export type RailMap = Record<Side, string[]>;

const SIDES: Side[] = ["left", "right", "bottom"];

function readPersisted(
  namespace: string,
  defaults: RailMap,
): RailMap {
  try {
    const raw = localStorage.getItem(storageKey(namespace));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<RailMap>;
    const known = new Set<string>();
    for (const s of SIDES) for (const id of defaults[s]) known.add(id);

    const seen = new Set<string>();
    const out: RailMap = { left: [], right: [], bottom: [] };
    for (const s of SIDES) {
      for (const id of parsed[s] ?? []) {
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        out[s].push(id);
      }
    }
    // Append any defaults that weren't in the persisted shape (new
    // items added since last visit). They land in their default rail.
    for (const s of SIDES) {
      for (const id of defaults[s]) {
        if (seen.has(id)) continue;
        out[s].push(id);
        seen.add(id);
      }
    }
    return out;
  } catch {
    return defaults;
  }
}

function storageKey(namespace: string): string {
  return `catalyst-llm-sdk:${namespace}:item-rails`;
}

export interface UseItemRailsResult {
  rails: RailMap;
  /** Move `id` into `to`, inserting BEFORE `beforeId`. When `beforeId`
   * is null the item appends to the end of `to`. Same-rail reorders
   * work too (the dragged item is removed from its current position
   * before re-inserting). */
  moveItem: (id: string, to: Side, beforeId: string | null) => void;
  /** Reset assignments back to the defaults passed at construction. */
  reset: () => void;
}

export function useItemRails(
  namespace: string,
  defaultRails: RailMap,
): UseItemRailsResult {
  // Read once on first render. Subsequent renders with new default
  // shapes are detected via the union of known ids (see readPersisted).
  const defaultsKey = useMemo(
    () => SIDES.map((s) => defaultRails[s].join(",")).join("|"),
    [defaultRails],
  );
  const [rails, setRails] = useState<RailMap>(() =>
    readPersisted(namespace, defaultRails),
  );

  // Re-merge when the defaults change so newly-added items appear.
  // Existing assignments survive — readPersisted preserves them when
  // the persisted shape is still loadable.
  useEffect(() => {
    setRails(readPersisted(namespace, defaultRails));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, defaultsKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(namespace), JSON.stringify(rails));
    } catch {
      /* localStorage blocked */
    }
  }, [namespace, rails]);

  const moveItem = useCallback(
    (id: string, to: Side, beforeId: string | null) => {
      setRails((prev) => {
        let from: Side | null = null;
        for (const s of SIDES) {
          if (prev[s].includes(id)) {
            from = s;
            break;
          }
        }
        if (!from) return prev;

        // Compute the source list with the dragged item removed first
        // so the insertion index is correct even on same-rail reorders
        // (where the dragged item was originally at some earlier slot).
        const next: RailMap = { ...prev };
        if (from === to) {
          const withoutDragged = prev[to].filter((x) => x !== id);
          const insertAt =
            beforeId === null
              ? withoutDragged.length
              : Math.max(0, withoutDragged.indexOf(beforeId));
          if (
            withoutDragged.indexOf(id) === insertAt &&
            prev[to][insertAt] === id
          ) {
            return prev; // no-op: dropped onto its current slot
          }
          const reordered = [...withoutDragged];
          reordered.splice(insertAt, 0, id);
          next[to] = reordered;
          return next;
        }

        next[from] = prev[from].filter((x) => x !== id);
        const dest = [...prev[to]];
        const insertAt =
          beforeId === null
            ? dest.length
            : Math.max(0, dest.indexOf(beforeId));
        dest.splice(insertAt, 0, id);
        next[to] = dest;
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setRails(defaultRails);
  }, [defaultRails]);

  return { rails, moveItem, reset };
}
