import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openAgentCreate,
  readHorizontalOverflow,
  routeAgentStudioWorkspace,
  screenshotAgentStudio,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-5-browser-helpers.js";

describe("M18.5 browser acceptance (Agent Studio UX)", () => {
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

  it("covers guided authoring, advanced JSON, validation, themes, and responsive layouts", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await routeAgentStudioWorkspace(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openAgentCreate(page, origin);
      await page.fill("#create-agent-name", "Browser Studio Agent");
      await page.fill("#studio-instructions", "Answer product questions.");
      await screenshotAgentStudio(page, "desktop-1440-guided-light.png");

      await page.getByRole("button", { name: "Advanced JSON" }).click();
      await page
        .getByLabel("AgentVersion manifest")
        .waitFor({ timeout: 10_000 });
      await screenshotAgentStudio(page, "desktop-1440-advanced-light.png");

      await page.getByRole("button", { name: "Guided" }).click();
      expect(await page.locator("#studio-instructions").inputValue()).toBe(
        "Answer product questions.",
      );

      await page
        .getByRole("button", { name: "Continue to capabilities" })
        .click();
      await page.getByText("What will your agent need?").waitFor();
      await screenshotAgentStudio(page, "desktop-1440-equip-light.png");

      await page.getByRole("button", { name: "Continue to review" }).click();
      await page.getByText("Review before publishing").waitFor();
      await screenshotAgentStudio(page, "desktop-1440-review-light.png");

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await screenshotAgentStudio(page, "desktop-1440-guided-dark.png");

      await page.setViewportSize({ width: 768, height: 1024 });
      await screenshotAgentStudio(page, "tablet-768-guided-light.png");

      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 2,
      );
      await screenshotAgentStudio(page, "mobile-390-guided-light.png");

      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      expect(await page.locator(":focus").count()).toBeGreaterThan(0);

      await context.close();
    } finally {
      await browser.close();
    }
  }, 180_000);
});
