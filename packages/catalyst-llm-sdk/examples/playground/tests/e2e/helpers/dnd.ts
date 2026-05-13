import type { Locator } from "@playwright/test";

/** MIME the SDK uses for SidePanelItem drags — duplicated here so the
 * tests don't import from the SDK source tree. Keep in sync with
 * `SIDEPANEL_ITEM_DND_TYPE` in sidepanel-internals.ts. */
export const SIDEPANEL_DND_MIME = "application/x-catalyst-sidepanel-item";

/** Fire a full synthetic HTML5 drag sequence (dragstart → dragenter →
 * dragover → drop → dragend) from `source` to the element at
 * `(clientX, clientY)`. The custom-MIME `dataTransfer` is shared across
 * every event so React's drag handlers see the same payload they'd
 * see from a real native drag.
 *
 * Playwright's `locator.dragTo` simulates a mouse drag, which doesn't
 * always trigger `dragstart` on a [draggable] child element when the
 * source is nested (our grip handle inside the header). Dispatching
 * native DragEvents inside a single page evaluate sidesteps that. */
export async function dispatchItemDrag(
  source: Locator,
  payload: { itemId: string; clientX: number; clientY: number },
): Promise<void> {
  await source.evaluate(
    (sourceEl, { mime, itemId, clientX, clientY }) => {
      const dropEl = document.elementFromPoint(clientX, clientY);
      if (!dropEl) throw new Error(`no element at (${clientX}, ${clientY})`);
      const dt = new DataTransfer();
      dt.setData(mime, itemId);
      const fire = (el: Element, type: string) => {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            dataTransfer: dt,
          }),
        );
      };
      fire(sourceEl, "dragstart");
      fire(dropEl, "dragenter");
      fire(dropEl, "dragover");
      fire(dropEl, "drop");
      fire(sourceEl, "dragend");
    },
    { mime: SIDEPANEL_DND_MIME, itemId: payload.itemId, clientX: payload.clientX, clientY: payload.clientY },
  );
}

/** Fire dragstart + dragover ONLY — the caller is expected to assert
 * on the indicator / hover state, then call `finishDrag` to close out.
 * Used by the drop-indicator test. */
export async function startDragHover(
  source: Locator,
  payload: { itemId: string; clientX: number; clientY: number },
): Promise<void> {
  await source.evaluate(
    (sourceEl, { mime, itemId, clientX, clientY }) => {
      const dropEl = document.elementFromPoint(clientX, clientY);
      if (!dropEl) throw new Error(`no element at (${clientX}, ${clientY})`);
      const dt = new DataTransfer();
      dt.setData(mime, itemId);
      const fire = (el: Element, type: string) => {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            dataTransfer: dt,
          }),
        );
      };
      fire(sourceEl, "dragstart");
      fire(dropEl, "dragenter");
      fire(dropEl, "dragover");
    },
    { mime: SIDEPANEL_DND_MIME, itemId: payload.itemId, clientX: payload.clientX, clientY: payload.clientY },
  );
}

/** Drop + dragend, to clean up after `startDragHover`. */
export async function finishDrag(
  source: Locator,
  payload: { itemId: string; clientX: number; clientY: number },
): Promise<void> {
  await source.evaluate(
    (sourceEl, { mime, itemId, clientX, clientY }) => {
      const dropEl = document.elementFromPoint(clientX, clientY);
      if (!dropEl) return;
      const dt = new DataTransfer();
      dt.setData(mime, itemId);
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            dataTransfer: dt,
          }),
        );
      fire(dropEl, "drop");
      fire(sourceEl, "dragend");
    },
    { mime: SIDEPANEL_DND_MIME, itemId: payload.itemId, clientX: payload.clientX, clientY: payload.clientY },
  );
}
