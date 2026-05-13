import { expect, test } from "@playwright/test";
import { EnginePage } from "../pages/EnginePage";

/** §A rail splitters + §B SidePanelItem collapse / expand. */

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

  test("renders at least 3 rail-level splitters", async () => {
    // 3 rail splitters (left|center, center|right, top|bottom) + any
    // intra-rail splitters that show up at defaults. Minimum is 3.
    expect(await engine.allSplitters().count()).toBeGreaterThanOrEqual(3);
  });

  test("splitters carry col-resize / row-resize cursors", async ({ page }) => {
    const cursors = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[role="separator"][title*="resize"]'),
      ).map((s) => getComputedStyle(s).cursor),
    );
    expect(cursors.some((c) => c === "col-resize")).toBe(true);
    expect(cursors.some((c) => c === "row-resize")).toBe(true);
  });

  test("drag left-rail splitter widens the left rail", async () => {
    const { before, after } = await engine.dragRailSplitter("left", 80);
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

  test("Agents expanded by default; Events collapsed by default", async () => {
    expect(await engine.isExpanded("engine.agents")).toBe(true);
    expect(await engine.isExpanded("engine.events")).toBe(false);
  });

  test("clicking the header toggles collapse state", async () => {
    await engine.expandItem("engine.events");
    expect(await engine.isExpanded("engine.events")).toBe(true);
    await engine.collapseItem("engine.events");
    expect(await engine.isExpanded("engine.events")).toBe(false);
  });

  test("intra-rail splitter appears between two expanded siblings", async () => {
    const before = await engine.allSplitters().count();
    await engine.expandItem("engine.events");
    expect(await engine.allSplitters().count()).toBe(before + 1);
  });

  test("intra-rail splitter drag changes the lower item's height", async () => {
    await engine.expandItem("engine.events");
    const { before, after } = await engine.dragInterItemSplitter(
      "engine.agents",
      "engine.events",
      -100, // drag UP → Events grows (Splitter is `invert: true`)
    );
    expect(after).toBeGreaterThanOrEqual(before + 80);
  });
});
