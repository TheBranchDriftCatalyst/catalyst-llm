import { expect, test } from "@playwright/test";
import { EnginePage } from "../../pages/EnginePage";

/** §D — Cross-rail + within-rail drag. Synthetic HTML5 DragEvents +
 * custom MIME live in `helpers/dnd.ts`; tests stay declarative through
 * the POM. */

test.describe("Cross-rail drag", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("every rail item exposes a drag handle", async () => {
    for (const id of [
      "engine.agents",
      "engine.events",
      "engine.test-run",
      "engine.node-detail",
      "engine.terminal",
    ]) {
      await expect(engine.itemDragHandle(id)).toBeVisible();
    }
  });

  test("Events: left → right rail", async () => {
    expect(await engine.whichRail("engine.events")).toBe("left");
    await engine.dragItem("engine.events", { kind: "rail", side: "right" });
    expect(await engine.whichRail("engine.events")).toBe("right");
    expect(await engine.itemOrder("right")).toContain("engine.events");
  });

  test("Test run: right → left rail", async () => {
    expect(await engine.whichRail("engine.test-run")).toBe("right");
    await engine.dragItem("engine.test-run", { kind: "rail", side: "left" });
    expect(await engine.whichRail("engine.test-run")).toBe("left");
  });
});

test.describe("Within-rail reorder", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("drag Events ABOVE Agents reorders left rail", async () => {
    expect(await engine.itemOrder("left")).toEqual([
      "engine.agents",
      "engine.events",
    ]);

    await engine.dragItem("engine.events", {
      kind: "before-item",
      itemId: "engine.agents",
    });

    expect(await engine.itemOrder("left")).toEqual([
      "engine.events",
      "engine.agents",
    ]);
  });

  test("drop indicator shows while a drag is in progress", async () => {
    const coords = await engine.beginDragHover("engine.events", {
      kind: "before-item",
      itemId: "engine.agents",
    });

    const indicator = engine.rail("left").locator("[data-drop-indicator]");
    await expect(indicator).toBeVisible();

    await engine.endDrag("engine.events", coords);
  });
});
