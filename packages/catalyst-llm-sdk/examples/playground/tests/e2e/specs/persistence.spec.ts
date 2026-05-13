import { expect, test } from "@playwright/test";
import { EnginePage } from "../pages/EnginePage";

/** §F — State persistence across reload.
 * Every layout interaction (collapse, drag, splitter resize) writes to
 * localStorage. After a hard reload the layout should look the same. */

test.describe("Persistence", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("collapsed state survives reload", async ({ page }) => {
    await engine.expandItem("engine.events");
    expect(await engine.isExpanded("engine.events")).toBe(true);

    await page.reload();
    await expect(engine.pageShell).toBeVisible();
    expect(await engine.isExpanded("engine.events")).toBe(true);
  });

  test("rail splitter size survives reload", async ({ page }) => {
    const { after } = await engine.dragRailSplitter("left", 60);
    await page.reload();
    await expect(engine.pageShell).toBeVisible();
    const reloaded = (await engine.railBox("left")).width;
    expect(Math.abs(reloaded - after)).toBeLessThanOrEqual(2);
  });

  test("cross-rail assignment survives reload", async ({ page }) => {
    await engine.dragItem("engine.events", { kind: "rail", side: "right" });
    expect(await engine.whichRail("engine.events")).toBe("right");

    await page.reload();
    await expect(engine.pageShell).toBeVisible();
    expect(await engine.whichRail("engine.events")).toBe("right");
  });

  test("within-rail reorder survives reload", async ({ page }) => {
    await engine.dragItem("engine.events", {
      kind: "before-item",
      itemId: "engine.agents",
    });
    expect(await engine.itemOrder("left")).toEqual([
      "engine.events",
      "engine.agents",
    ]);

    await page.reload();
    await expect(engine.pageShell).toBeVisible();
    expect(await engine.itemOrder("left")).toEqual([
      "engine.events",
      "engine.agents",
    ]);
  });

  test("intra-rail splitter size survives reload", async ({ page }) => {
    await engine.expandItem("engine.events");
    const { after } = await engine.dragInterItemSplitter(
      "engine.agents",
      "engine.events",
      -80,
    );

    await page.reload();
    await expect(engine.pageShell).toBeVisible();
    // After reload the Events item should still be ~`after` tall (the
    // splitter wrote its CSS var via a dedicated storage key).
    await engine.expandItem("engine.events");
    const reloaded = (await engine.itemBox("engine.events")).height;
    expect(Math.abs(reloaded - after)).toBeLessThanOrEqual(5);
  });
});
