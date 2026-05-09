/**
 * Thin recording helpers + a Zustand store the StatsView re-renders
 * off of when new rows land. The DB itself is the source of truth —
 * the store only tracks "last write" / "row count" so React can poll
 * without hammering DuckDB.
 */
import { create } from "zustand";
import { recordRow, type MetricsRow } from "./db.js";

interface MetricsState {
  /** Total rows recorded this session. The StatsView watches this so
   * its summary cards re-query DuckDB when new data lands. */
  rowCount: number;
  /** Wall-clock of the most recent successful write (ms). */
  lastWrittenAt: number;
  /** Last error, if a write failed. */
  lastError: string | null;
  /** Increment internal counters after a successful write. */
  _bump: (err?: unknown) => void;
}

export const useMetricsStore = create<MetricsState>((set) => ({
  rowCount: 0,
  lastWrittenAt: 0,
  lastError: null,
  _bump: (err) =>
    set((s) =>
      err
        ? { ...s, lastError: err instanceof Error ? err.message : String(err) }
        : {
            rowCount: s.rowCount + 1,
            lastWrittenAt: Date.now(),
            lastError: null,
          },
    ),
}));

/**
 * Append one row to the metrics table. Errors are caught and surfaced
 * via the store so they never propagate up and break a chat completion.
 */
export async function record(row: MetricsRow): Promise<void> {
  const bump = useMetricsStore.getState()._bump;
  try {
    await recordRow(row);
    bump();
  } catch (err) {
    console.warn("[catalyst-llm-sdk/dev] metrics record failed:", err);
    bump(err);
  }
}

/**
 * Hash a string into a short, stable id suitable for grouping prompts
 * across runs without storing the prompt body. Good enough for
 * collision-resistant analytics, not for security.
 */
export function shortHash(s: string | undefined): string | undefined {
  if (!s) return undefined;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  // Clamp to unsigned 32-bit and base36-encode for compactness.
  return ((h >>> 0).toString(36)).padStart(7, "0");
}
