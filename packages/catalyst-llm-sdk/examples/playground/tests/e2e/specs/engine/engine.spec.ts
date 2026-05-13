import { expect, test } from "@playwright/test";
import { EnginePage } from "../../pages/EnginePage";

/** §E — Engine-specific item rendering. Backend-independent: we assert
 * the chrome renders even when /api/agents is unreachable (empty state)
 * AND, when the backend IS up, the expected agent ids show. */

test.describe("Engine items", () => {
  let engine: EnginePage;

  test.beforeEach(async ({ page }) => {
    engine = new EnginePage(page);
    await engine.goto();
    await engine.resetState();
  });

  test("Agents item exists and has a refresh button in its header", async ({
    page,
  }) => {
    const refresh = engine
      .itemHeader("engine.agents")
      .getByTitle("Refresh /api/agents");
    await expect(refresh).toBeVisible();
  });

  test("Test run item renders prompt textarea + run button", async () => {
    const testRun = engine.item("engine.test-run");
    await expect(testRun.getByPlaceholder(/Ask .* something/)).toBeVisible();
    await expect(testRun.getByRole("button", { name: /^run$/i })).toBeVisible();
  });

  test("Terminal item renders in the bottom rail by default", async () => {
    expect(await engine.whichRail("engine.terminal")).toBe("bottom");
  });

  test("Node detail starts collapsed by default", async () => {
    expect(await engine.isExpanded("engine.node-detail")).toBe(false);
  });

  test("ReactFlow zoom controls are visible inside the canvas", async ({
    page,
  }) => {
    // The +/-/fit chip lives inside the topology canvas in the center.
    await expect(
      page.locator(".react-flow__controls").first(),
    ).toBeVisible();
  });

  test("topology renders __start__, __end__ for the default agent (if /api/agents resolves)", async ({
    page,
  }) => {
    // Skip when the backend isn't up — the Agents list shows the empty
    // state and no topology renders.
    const noAgentsText = page.getByText(/No agents registered/);
    if (await noAgentsText.isVisible().catch(() => false)) {
      test.skip(
        true,
        "/api/agents unavailable — backend not running",
      );
    }
    await expect(page.getByText("__start__")).toBeVisible();
    await expect(page.getByText("__end__")).toBeVisible();
  });
});
