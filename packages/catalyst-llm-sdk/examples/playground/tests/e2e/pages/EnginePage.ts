import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type Side = "left" | "right" | "bottom";

/** Page Object Model for the Engine tab.
 *
 * Exposes typed locators for every rail / item / splitter the layout
 * tests interact with, plus high-level action helpers (collapse,
 * dragItem, dragRailSplitter, dragInterItemSplitter, reload + state
 * round-trip). Tests stay declarative.
 */
export class EnginePage {
  constructor(public readonly page: Page) {}

  // ─── Top-level locators ──────────────────────────────────────────

  get pageShell(): Locator {
    return this.page.locator(".page-shell");
  }

  rail(side: Side): Locator {
    return this.page.locator(`[data-side="${side}"]`);
  }

  /** Every SidePanelItem `<section>` carries `data-sidepanel-item`. */
  item(id: string): Locator {
    return this.page.locator(`[data-sidepanel-item="${id}"]`);
  }

  /** The clickable header of an item (chevron + title + grip). */
  itemHeader(id: string): Locator {
    return this.item(id).locator("header").first();
  }

  /** The draggable grip inside an item header (only present when the
   * parent rail has onItemMove wired). */
  itemDragHandle(id: string): Locator {
    return this.itemHeader(id).locator('[aria-label="Drag handle"]');
  }

  /** Every Splitter renders as `[role=separator]` with the title
   * `drag to resize · double-click to reset`. There are 3 rail-level
   * splitters + N intra-rail splitters between adjacent expanded
   * items. */
  allSplitters(): Locator {
    return this.page.locator('[role="separator"][title*="resize"]');
  }

  // ─── Lifecycle helpers ───────────────────────────────────────────

  async goto(): Promise<void> {
    // Hit the Engine route directly so we don't depend on Chat default.
    await this.page.goto("/engine");
    await expect(this.pageShell).toBeVisible();
  }

  /** Wipe every `catalyst-llm-sdk:*` key + reload. Tests should call
   * this in `beforeEach` so each test starts from defaults. */
  async resetState(): Promise<void> {
    await this.page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("catalyst-llm-sdk:")) localStorage.removeItem(k);
      }
    });
    await this.page.reload();
    await expect(this.pageShell).toBeVisible();
  }

  // ─── State observers ─────────────────────────────────────────────

  /** Bounding box of the named rail in CSS pixels. */
  async railBox(side: Side): Promise<{ x: number; y: number; width: number; height: number }> {
    const b = await this.rail(side).boundingBox();
    if (!b) throw new Error(`rail "${side}" not visible`);
    return b;
  }

  /** Bounding box of an item section. */
  async itemBox(id: string): Promise<{ x: number; y: number; width: number; height: number }> {
    const b = await this.item(id).boundingBox();
    if (!b) throw new Error(`item "${id}" not visible`);
    return b;
  }

  /** True when the item is currently expanded (data-collapsed absent). */
  async isExpanded(id: string): Promise<boolean> {
    return !(await this.item(id).getAttribute("data-collapsed"));
  }

  /** Which rail an item is currently in, by DOM ancestry. */
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
    return this.rail(side).evaluate((panel) => {
      const items = Array.from(
        panel.querySelectorAll("[data-sidepanel-item]"),
      );
      return items.map((el) => el.getAttribute("data-sidepanel-item")!);
    });
  }

  // ─── Action helpers ──────────────────────────────────────────────

  /** Click the header (NOT the grip) to toggle collapsed state.
   * The grip span sits at x≈6-22 inside the header and carries
   * `stopPropagation`, so we click past it on the chevron / title
   * area. Click at the horizontal CENTER which is reliably the title
   * text region for every item. */
  async toggleItem(id: string): Promise<void> {
    const header = this.itemHeader(id);
    const box = await header.boundingBox();
    if (!box) throw new Error(`item header ${id} not visible`);
    // 40px from left edge is past the 22px-wide grip + chevron icon.
    await this.page.mouse.click(box.x + 40, box.y + box.height / 2);
  }

  async expandItem(id: string): Promise<void> {
    if (!(await this.isExpanded(id))) await this.toggleItem(id);
  }

  async collapseItem(id: string): Promise<void> {
    if (await this.isExpanded(id)) await this.toggleItem(id);
  }

  /** Drag a rail-level splitter by `delta` pixels along its axis.
   * The rail boundary moves by that delta (left/right rail splitters
   * widen/shrink horizontally; bottom splitter heights vertically). */
  async dragRailSplitter(
    side: Side,
    delta: number,
  ): Promise<{ before: number; after: number }> {
    const before =
      side === "bottom"
        ? (await this.railBox("bottom")).height
        : (await this.railBox(side)).width;

    // Locate the rail's adjacent splitter by hit-testing against the
    // rail box edge — splitters are 4px-wide grid cells abutting the
    // rail. We pick a Y midpoint for vertical splitters / X midpoint
    // for the horizontal one.
    const railBox = await this.railBox(side);
    let splitterX: number;
    let splitterY: number;
    if (side === "left") {
      splitterX = railBox.x + railBox.width + 2; // 4px-wide cell, center
      splitterY = railBox.y + railBox.height / 2;
    } else if (side === "right") {
      splitterX = railBox.x - 2;
      splitterY = railBox.y + railBox.height / 2;
    } else {
      splitterX = railBox.x + railBox.width / 2;
      splitterY = railBox.y - 2;
    }

    await this.page.mouse.move(splitterX, splitterY);
    await this.page.mouse.down();
    if (side === "left") {
      await this.page.mouse.move(splitterX + delta, splitterY, { steps: 10 });
    } else if (side === "right") {
      await this.page.mouse.move(splitterX - delta, splitterY, { steps: 10 });
    } else {
      await this.page.mouse.move(splitterX, splitterY - delta, { steps: 10 });
    }
    await this.page.mouse.up();

    const after =
      side === "bottom"
        ? (await this.railBox("bottom")).height
        : (await this.railBox(side)).width;
    return { before, after };
  }

  /** Drag the intra-rail splitter between two adjacent expanded items.
   * `aboveId` is the item ABOVE the splitter, `belowId` is the item
   * BELOW. Returns before/after height of the BELOW item (which is
   * the one the splitter directly sizes via its CSS var). */
  async dragInterItemSplitter(
    aboveId: string,
    belowId: string,
    deltaY: number,
  ): Promise<{ before: number; after: number }> {
    const before = (await this.itemBox(belowId)).height;

    const aboveBox = await this.itemBox(aboveId);
    const belowBox = await this.itemBox(belowId);
    // Splitter sits between the two — center its hit point on the gap.
    const gapY = (aboveBox.y + aboveBox.height + belowBox.y) / 2;
    const splitterX = aboveBox.x + aboveBox.width / 2;

    await this.page.mouse.move(splitterX, gapY);
    await this.page.mouse.down();
    await this.page.mouse.move(splitterX, gapY + deltaY, { steps: 10 });
    await this.page.mouse.up();

    const after = (await this.itemBox(belowId)).height;
    return { before, after };
  }

  /** Drag an item to a target item or to the empty space of a rail.
   * Uses native HTML5 drag/drop events with the SDK's custom MIME type
   * because Playwright's locator.dragTo simulates a mouse drag, which
   * doesn't always fire dragstart on a [draggable] child element. */
  async dragItem(
    sourceId: string,
    target: { kind: "before-item"; itemId: string } | { kind: "rail"; side: Side },
  ): Promise<void> {
    const handle = this.itemDragHandle(sourceId);
    await expect(handle).toBeVisible();

    // Determine target element + bounding box for the drop position.
    const dropLocator =
      target.kind === "before-item"
        ? this.item(target.itemId)
        : this.rail(target.side);
    const dropBox = await dropLocator.boundingBox();
    if (!dropBox) throw new Error("drop target not visible");

    // For before-item: drop on the TOP of the target item so the
    //   insertion indicator lands BEFORE that item.
    // For rail: drop on the very bottom so it appends.
    const dropX = dropBox.x + dropBox.width / 2;
    const dropY =
      target.kind === "before-item"
        ? dropBox.y + 4
        : dropBox.y + dropBox.height - 8;

    await handle.evaluate(
      (sourceEl, args) => {
        const { dropX, dropY, sourceId } = args as {
          dropX: number;
          dropY: number;
          sourceId: string;
        };
        const dropEl = document.elementFromPoint(dropX, dropY);
        if (!dropEl) throw new Error("no element at drop point");

        const dt = new DataTransfer();
        dt.setData("application/x-catalyst-sidepanel-item", sourceId);

        // Walk up to find the panel root so dragover/drop fire on the
        // element that carries the listeners.
        const fireOn = (el: Element, type: string) => {
          const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: dropX,
            clientY: dropY,
            dataTransfer: dt,
          });
          el.dispatchEvent(ev);
        };

        fireOn(sourceEl, "dragstart");
        fireOn(dropEl, "dragenter");
        fireOn(dropEl, "dragover");
        fireOn(dropEl, "drop");
        fireOn(sourceEl, "dragend");
      },
      { dropX, dropY, sourceId },
    );
  }
}
