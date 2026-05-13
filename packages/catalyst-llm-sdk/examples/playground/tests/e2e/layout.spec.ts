import { expect, test } from "@playwright/test";
import { EnginePage } from "./pages/EnginePage";

/** §A — PageShell + rail-level splitters + §B — SidePanelItem collapse. */

test.describe("PageShell layout", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("renders all three rails", async () => {
    await expect(engine.rail("left")).toBeVisible();
    await expect(engine.rail("right")).toBeVisible();
    await expect(engine.rail("bottom")).toBeVisible();
  });

  test("renders three rail-level splitters (left|center, center|right, top|bottom)", async () => {
    // 3 rail splitters + 1 intra-left (Agents vs collapsed Events shouldn't
    // produce one — both items must be EXPANDED to get an intra-rail splitter)
    // and 1 intra-right (Test run vs collapsed Node detail) = 3 total at
    // defaults. Assert at least 3 (rail-level) are present.
    const count = await engine.allSplitters().count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("rail splitters have col-resize / row-resize cursor", async ({ page }) => {
    const cursors = await page.evaluate(() => {
      const out: string[] = [];
      for (const s of document.querySelectorAll(
        '[role="separator"][title*="resize"]',
      )) {
        out.push(getComputedStyle(s).cursor);
      }
      return out;
    });
    // At least one of each axis present.
    expect(cursors.some((c) => c === "col-resize")).toBe(true);
    expect(cursors.some((c) => c === "row-resize")).toBe(true);
  });

  test("drag left-rail splitter widens the left rail", async () => {
    const { before, after } = await engine.dragRailSplitter("left", 80);
    // Allow ±5px slack for hit-area math.
    expect(after).toBeGreaterThanOrEqual(before + 70);
  });

  test("drag right-rail splitter widens the right rail", async () => {
    const { before, after } = await engine.dragRailSplitter("right", 80);
    expect(after).toBeGreaterThanOrEqual(before + 70);
  });

  test("drag bottom-rail splitter grows the bottom rail", async () => {
    const { before, after } = await engine.dragRailSplitter("bottom", 60);
    expect(after).toBeGreaterThanOrEqual(before + 50);
  });
});

test.describe("SidePanelItem collapse / expand", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("Agents is expanded by default; Events is collapsed by default", async () => {
    expect(await engine.isExpanded("engine.agents")).toBe(true);
    expect(await engine.isExpanded("engine.events")).toBe(false);
  });

  test("clicking the Events header expands it; clicking again collapses", async () => {
    await engine.expandItem("engine.events");
    expect(await engine.isExpanded("engine.events")).toBe(true);
    await engine.collapseItem("engine.events");
    expect(await engine.isExpanded("engine.events")).toBe(false);
  });

  test("intra-rail splitter appears between two expanded siblings", async () => {
    const before = await engine.allSplitters().count();
    await engine.expandItem("engine.events");
    const after = await engine.allSplitters().count();
    expect(after).toBe(before + 1);
  });

  test("intra-rail splitter resize changes the lower item's height", async () => {
    await engine.expandItem("engine.events");
    const { before, after } = await engine.dragInterItemSplitter(
      "engine.agents",
      "engine.events",
      -100, // drag splitter UP → Events GROWS (invert: true)
    );
    expect(after).toBeGreaterThanOrEqual(before + 80);
  });
});
