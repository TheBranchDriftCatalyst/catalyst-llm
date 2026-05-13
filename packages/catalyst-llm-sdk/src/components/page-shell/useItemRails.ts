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
  moveItem: (id: string, to: Side) => void;
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

  const moveItem = useCallback((id: string, to: Side) => {
    setRails((prev) => {
      let from: Side | null = null;
      for (const s of SIDES) {
        if (prev[s].includes(id)) {
          from = s;
          break;
        }
      }
      if (!from || from === to) return prev;
      return {
        ...prev,
        [from]: prev[from].filter((x) => x !== id),
        [to]: [...prev[to], id],
      };
    });
  }, []);

  const reset = useCallback(() => {
    setRails(defaultRails);
  }, [defaultRails]);

  return { rails, moveItem, reset };
}
