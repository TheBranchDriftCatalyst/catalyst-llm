/**
 * Tiny fuzzy matcher tuned for short identifier-like strings (model names).
 * Returns a non-negative score when `pattern` matches `text` in order, with
 * higher scores for tighter matches and prefix/word-boundary hits.
 *
 * Returns null if the pattern characters can't be matched in order.
 */
export function fuzzyScore(pattern: string, text: string): number | null {
  if (!pattern) return 1;
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let pi = 0;
  let prevMatchedAt = -2;
  for (let ti = 0; ti < t.length && pi < p.length; ti++) {
    if (t[ti] === p[pi]) {
      // bonus for consecutive chars + word-boundary chars
      if (prevMatchedAt === ti - 1) score += 5;
      if (ti === 0 || /[\W_/-]/.test(t[ti - 1])) score += 3;
      score += 1;
      prevMatchedAt = ti;
      pi++;
    }
  }
  if (pi < p.length) return null;
  // shorter haystacks score higher
  return score - t.length * 0.01;
}

export function fuzzyFilter<T>(
  items: T[],
  pattern: string,
  getText: (item: T) => string,
): T[] {
  if (!pattern.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(pattern, getText(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
