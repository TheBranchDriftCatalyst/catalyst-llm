import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { dispatchItemDrag, finishDrag, startDragHover } from "../helpers/dnd";

export type Side = "left" | "right" | "bottom";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Page Object Model for the Engine tab.
 *
 * Locators target structural attributes (data-side, data-sidepanel-item)
 * over class names so refactors of styling don't break tests. Action
 * helpers (toggleItem, dragItem, dragRailSplitter,
 * dragInterItemSplitter, resetState) hide the lower-level event
 * dispatch and coordinate math; specs stay declarative. */
export class EnginePage {
  constructor(public readonly page: Page) {}

  // ─── Locators ─────────────────────────────────────────────────────

  get pageShell(): Locator {
    return this.page.locator(".page-shell");
  }

  rail(side: Side): Locator {
    return this.page.locator(`[data-side="${side}"]`);
  }

  item(id: string): Locator {
    return this.page.locator(`[data-sidepanel-item="${id}"]`);
  }

  itemHeader(id: string): Locator {
    return this.item(id).locator("header").first();
  }

  itemTitle(id: string): Locator {
    // The visible title <span class="flex-1 truncate"> in the header.
    // Clicking THIS is a safe way to toggle without hitting the grip
    // (which carries stopPropagation) or any right-side action button.
    return this.itemHeader(id).locator("span.flex-1").first();
  }

  itemDragHandle(id: string): Locator {
    return this.itemHeader(id).locator('[aria-label="Drag handle"]');
  }

  allSplitters(): Locator {
    return this.page.locator('[role="separator"][title*="resize"]');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto("/engine");
    await expect(this.pageShell).toBeVisible();
  }

  /** Wipe every `catalyst-llm-sdk:*` localStorage key + reload so the
   * test starts from documented defaults. Call from `beforeEach`. */
  async resetState(): Promise<void> {
    await this.page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("catalyst-llm-sdk:")) localStorage.removeItem(k);
      }
    });
    await this.page.reload();
    await expect(this.pageShell).toBeVisible();
  }

  // ─── Observers ───────────────────────────────────────────────────

  async railBox(side: Side): Promise<Box> {
    return this.requireBox(this.rail(side), `rail "${side}"`);
  }

  async itemBox(id: string): Promise<Box> {
    return this.requireBox(this.item(id), `item "${id}"`);
  }

  async isExpanded(id: string): Promise<boolean> {
    return !(await this.item(id).getAttribute("data-collapsed"));
  }

  async whichRail(id: string): Promise<Side> {
    const side = await this.item(id).evaluate((el) => {
      const panel = el.closest("[data-side]");
      return panel?.getAttribute("data-side") ?? null;
    });
    if (side !== "left" && side !== "right" && side !== "bottom") {
      throw new Error(`item is not in a known rail (got: ${side})`);
    }
    return side;
  }

  /** Ordered list of item ids in a rail, top-to-bottom. */
  async itemOrder(side: Side): Promise<string[]> {
    return this.rail(side).evaluate((panel) =>
      Array.from(panel.querySelectorAll("[data-sidepanel-item]")).map(
        (el) => el.getAttribute("data-sidepanel-item")!,
      ),
    );
  }

  // ─── Actions ─────────────────────────────────────────────────────

  /** Toggle collapsed state by dispatching a native click on the
   * `<header>` directly. We bypass Playwright's coordinate-based
   * click because the header has a left-edge grip (stopPropagation)
   * and a right-edge action slot (also stopPropagation) — the safe
   * area is narrow and depends on the item's content. A direct
   * `element.click()` reaches the header's React onClick reliably. */
  async toggleItem(id: string): Promise<void> {
    await this.itemHeader(id).evaluate((el) => (el as HTMLElement).click());
  }

  async expandItem(id: string): Promise<void> {
    if (!(await this.isExpanded(id))) await this.toggleItem(id);
  }

  async collapseItem(id: string): Promise<void> {
    if (await this.isExpanded(id)) await this.toggleItem(id);
  }

  /** Drag a rail-level splitter by `delta` pixels along its axis. The
   * rail boundary moves by that delta (left/right rails widen on
   * horizontal drag; bottom rail grows on vertical drag). */
  async dragRailSplitter(
    side: Side,
    delta: number,
  ): Promise<{ before: number; after: number }> {
    const measure = async () =>
      side === "bottom"
        ? (await this.railBox("bottom")).height
        : (await this.railBox(side)).width;
    const before = await measure();
    const { x, y, dx, dy } = await this.railSplitterDragVector(side, delta);

    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y + dy, { steps: 10 });
    await this.page.mouse.up();

    return { before, after: await measure() };
  }

  /** Drag the splitter between two adjacent EXPANDED items. Returns
   * before/after height of `belowId` (the splitter writes that item's
   * CSS var via `invert: true`). */
  async dragInterItemSplitter(
    aboveId: string,
    belowId: string,
    deltaY: number,
  ): Promise<{ before: number; after: number }> {
    const before = (await this.itemBox(belowId)).height;

    const aboveBox = await this.itemBox(aboveId);
    const belowBox = await this.itemBox(belowId);
    const gapY = (aboveBox.y + aboveBox.height + belowBox.y) / 2;
    const splitterX = aboveBox.x + aboveBox.width / 2;

    await this.page.mouse.move(splitterX, gapY);
    await this.page.mouse.down();
    await this.page.mouse.move(splitterX, gapY + deltaY, { steps: 10 });
    await this.page.mouse.up();

    return { before, after: (await this.itemBox(belowId)).height };
  }

  /** Move an item to a new position via synthetic HTML5 drag:
   *   { kind: "before-item", itemId } — insert BEFORE that item
   *   { kind: "rail", side }          — append to that rail's end
   */
  async dragItem(
    sourceId: string,
    target:
      | { kind: "before-item"; itemId: string }
      | { kind: "rail"; side: Side },
  ): Promise<void> {
    const handle = this.itemDragHandle(sourceId);
    await expect(handle).toBeVisible();
    const { x, y } = await this.dropCoords(target);
    await dispatchItemDrag(handle, {
      itemId: sourceId,
      clientX: x,
      clientY: y,
    });
  }

  /** Begin a drag without dropping — used to assert on the visual
   * indicator. Pair with `endDrag` to clean up. */
  async beginDragHover(
    sourceId: string,
    target:
      | { kind: "before-item"; itemId: string }
      | { kind: "rail"; side: Side },
  ): Promise<{ clientX: number; clientY: number }> {
    const handle = this.itemDragHandle(sourceId);
    const { x, y } = await this.dropCoords(target);
    await startDragHover(handle, { itemId: sourceId, clientX: x, clientY: y });
    return { clientX: x, clientY: y };
  }

  async endDrag(
    sourceId: string,
    coords: { clientX: number; clientY: number },
  ): Promise<void> {
    const handle = this.itemDragHandle(sourceId);
    await finishDrag(handle, { itemId: sourceId, ...coords });
  }

  // ─── Internals ───────────────────────────────────────────────────

  private async requireBox(loc: Locator, label: string): Promise<Box> {
    const b = await loc.boundingBox();
    if (!b) throw new Error(`${label} not visible`);
    return b;
  }

  /** Mouse-down coords + drag delta for a rail-level splitter, given
   * a desired width/height delta. The cell is 4px-wide in the grid,
   * but the splitter element extends ±3px via negative margins, so
   * landing ON the cell midpoint is reliable. */
  private async railSplitterDragVector(
    side: Side,
    delta: number,
  ): Promise<{ x: number; y: number; dx: number; dy: number }> {
    const railBox = await this.railBox(side);
    if (side === "left") {
      return {
        x: railBox.x + railBox.width + 2,
        y: railBox.y + railBox.height / 2,
        dx: delta,
        dy: 0,
      };
    }
    if (side === "right") {
      return {
        x: railBox.x - 2,
        y: railBox.y + railBox.height / 2,
        dx: -delta,
        dy: 0,
      };
    }
    return {
      x: railBox.x + railBox.width / 2,
      y: railBox.y - 2,
      dx: 0,
      dy: -delta,
    };
  }

  /** Resolve a drop-target into clientX/clientY coordinates. */
  private async dropCoords(
    target:
      | { kind: "before-item"; itemId: string }
      | { kind: "rail"; side: Side },
  ): Promise<{ x: number; y: number }> {
    if (target.kind === "before-item") {
      const box = await this.itemBox(target.itemId);
      // Top 4px of the target item — places the cursor above its
      // vertical midpoint so the panel resolves "insert BEFORE".
      return { x: box.x + box.width / 2, y: box.y + 4 };
    }
    const box = await this.railBox(target.side);
    // Bottom-of-rail empty area → cursor below every item → append.
    return { x: box.x + box.width / 2, y: box.y + box.height - 8 };
  }
}
