/**
 * Public-surface smoke check — assert that every value-shape export
 * from every public barrel actually resolves at import time. Catches
 * future barrel-rewrite regressions (a moved file, a typo'd path)
 * cheaply without spinning up a browser or rendering anything.
 *
 * We import the namespace and walk it for non-undefined entries. Type-
 * only exports get stripped at runtime, so they won't appear here —
 * the check is for runtime exports only.
 */
import { describe, expect, it } from "vitest";

import * as components from "../src/components/index.js";
import * as react from "../src/react/index.js";
import * as client from "../src/client/index.js";
import * as agent from "../src/agent/index.js";
import * as dev from "../src/dev/index.js";

const SURFACES = { components, react, client, agent, dev };

describe("public export surface", () => {
  for (const [name, mod] of Object.entries(SURFACES)) {
    it(`${name} exports resolve`, () => {
      const keys = Object.keys(mod);
      expect(keys.length, `${name} should expose at least one runtime export`).toBeGreaterThan(0);
      const undef = keys.filter(
        (k) => (mod as Record<string, unknown>)[k] === undefined,
      );
      expect(undef, `undefined exports in ${name}`).toEqual([]);
    });
  }
});
