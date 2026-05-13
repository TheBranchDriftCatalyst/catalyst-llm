import { expect, test } from "@playwright/test";
import { EnginePage } from "./pages/EnginePage";

/** §D — Cross-rail + within-rail drag. Native HTML5 drag events are
 * dispatched via locator.evaluate (see EnginePage.dragItem) because
 * Playwright's mouse-driven dragTo can miss the [draggable] grip. */

test.describe("Cross-rail drag", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("drag handle is visible on every rail item", async () => {
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

  test("Events (left) → right rail: appears in right's order", async () => {
    expect(await engine.whichRail("engine.events")).toBe("left");
    await engine.dragItem("engine.events", { kind: "rail", side: "right" });
    expect(await engine.whichRail("engine.events")).toBe("right");
    const rightOrder = await engine.itemOrder("right");
    expect(rightOrder).toContain("engine.events");
  });

  test("Test run (right) → left rail: appears in left's order", async () => {
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

  test("drag Events ABOVE Agents reorders within left rail", async () => {
    const initial = await engine.itemOrder("left");
    expect(initial).toEqual(["engine.agents", "engine.events"]);

    await engine.dragItem("engine.events", {
      kind: "before-item",
      itemId: "engine.agents",
    });

    const after = await engine.itemOrder("left");
    expect(after).toEqual(["engine.events", "engine.agents"]);
  });

  test("drop indicator (glowing line) renders during a drag", async ({
    page,
  }) => {
    // Simulate the first half of a drag (dragstart + dragover) and
    // assert the indicator div is present before we finish with drop.
    const handle = engine.itemDragHandle("engine.events");
    const targetBox = await engine.itemBox("engine.agents");

    await handle.evaluate(
      (sourceEl, args) => {
        const { x, y } = args as { x: number; y: number };
        const dropEl = document.elementFromPoint(x, y);
        if (!dropEl) throw new Error("no drop element");
        const dt = new DataTransfer();
        dt.setData(
          "application/x-catalyst-sidepanel-item",
          "engine.events",
        );
        const fire = (el: Element, type: string) =>
          el.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer: dt,
            }),
          );
        fire(sourceEl, "dragstart");
        fire(dropEl, "dragenter");
        fire(dropEl, "dragover");
      },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 4 },
    );

    // The indicator is `.bg-primary.shadow-...` absolute-positioned.
    // We use a structural attribute selector — any aria-hidden line
    // with the shadow class inside the left rail.
    const indicator = engine
      .rail("left")
      .locator('[aria-hidden="true"]')
      .filter({ hasNotText: /.+/ });
    await expect(indicator).toBeVisible();

    // Clean up: dispatch drop to end the drag.
    await handle.evaluate(
      (sourceEl, args) => {
        const { x, y } = args as { x: number; y: number };
        const dropEl = document.elementFromPoint(x, y);
        if (!dropEl) return;
        const dt = new DataTransfer();
        dt.setData(
          "application/x-catalyst-sidepanel-item",
          "engine.events",
        );
        const fire = (el: Element, type: string) =>
          el.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer: dt,
            }),
          );
        fire(dropEl, "drop");
        fire(sourceEl, "dragend");
      },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 4 },
    );
  });
});
