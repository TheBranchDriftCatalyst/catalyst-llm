import { diffLines, diffWordsWithSpace } from "diff";
import type { Change } from "diff";

export type { Change };

/** Line-level diff between two model outputs. */
export function lineDiff(a: string, b: string): Change[] {
  return diffLines(a, b, { ignoreWhitespace: false });
}

/** Word-level diff for a tighter inline view. */
export function wordDiff(a: string, b: string): Change[] {
  return diffWordsWithSpace(a, b);
}
