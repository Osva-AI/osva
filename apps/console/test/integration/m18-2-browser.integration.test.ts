import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHorizontalOverflow,
  routeActiveWorkspace,
  routeDegradedWorkspace,
  routeEmptyWorkspace,
  screenshotHome,
  seedShellStorage,
  startConsolePreviewServer,
  waitForHome,
} from "./m18-2-browser-helpers.js";

describe("M18.2 browser acceptance (Adaptive Home)", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  async function openHome(
    page: import("playwright").Page,
    theme: "light" | "dark",
  ) {
    await seedShellStorage(page, {
      workspaceId: "ws-admin",
      theme,
      sidebarCollapsed: false,
    });
    await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
    await waitForHome(page);
  }

  it("captures new, active, advanced, degraded, themes, and responsive layouts", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // New workspace (empty mock)
      await routeEmptyWorkspace(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openHome(page, "light");
      await page
        .getByRole("heading", {
          name: "What would you like AI to do for you?",
        })
        .waitFor();
      await screenshotHome(page, "desktop-1440-new-light.png");

      await page.getByLabel("Theme preference").selectOption("dark");
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await screenshotHome(page, "desktop-1440-new-dark.png");

      // Advanced presentation
      await page.getByRole("button", { name: "Advanced" }).click();
      await page.getByText("Resource navigation").waitFor();
      await screenshotHome(page, "desktop-1440-advanced-dark.png");
      await page
        .getByRole("group", { name: "Home presentation" })
        .getByRole("button", { name: "Standard", exact: true })
        .click();

      // Active workspace
      await page.unroute("**/api/v1/**");
      await routeActiveWorkspace(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForHome(page);
      await page.getByText(/Welcome back/i).waitFor();
      await screenshotHome(page, "desktop-1440-active-dark.png");

      // Degraded
      await page.unroute("**/api/v1/**");
      await routeDegradedWorkspace(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForHome(page);
      await page.getByText(/Home data is incomplete/i).waitFor();
      await screenshotHome(page, "desktop-1440-degraded-dark.png");

      // Tablet + mobile overflow
      await page.unroute("**/api/v1/**");
      await routeEmptyWorkspace(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForHome(page);

      await page.setViewportSize({ width: 768, height: 1024 });
      await screenshotHome(page, "tablet-768-new-light.png");
      let overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await screenshotHome(page, "mobile-390-new-light.png");
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      // Keyboard: presentation switch remains focusable
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(
        () => document.activeElement?.textContent ?? "",
      );
      expect(focused.length).toBeGreaterThan(0);

      await context.close();
    } finally {
      await browser.close();
    }
  }, 180_000);
});
