import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHorizontalOverflow,
  routeEmptyWorkspace,
  routeActiveWorkspace,
  screenshotPage,
  seedShellStorage,
  startConsolePreviewServer,
  waitForExamples,
  waitForHome,
} from "./m18-3-browser-helpers.js";

describe("M18.3 browser acceptance (Outcome discovery)", () => {
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

  async function openOverview(
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

  it("covers discovery, examples browse, detail, themes, and responsive layouts", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await routeEmptyWorkspace(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openOverview(page, "light");

      await page
        .getByRole("heading", {
          name: "What would you like AI to do for you?",
        })
        .waitFor();
      await screenshotPage(page, "desktop-1440-new-light-discovery.png");

      await page.getByRole("button", { name: "Create an SEO audit" }).click();
      await page.getByText("Recommended examples").waitFor();
      await page
        .getByRole("heading", { name: "SEO audit worker", level: 3 })
        .waitFor();
      await screenshotPage(page, "desktop-1440-new-light-seo-results.png");

      await page
        .getByRole("link", { name: "Browse all examples" })
        .first()
        .click();
      await waitForExamples(page);
      await screenshotPage(page, "desktop-1440-examples-browse-light.png");

      await page
        .getByRole("link", { name: "SEO audit worker" })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "SEO audit worker", level: 1 })
        .waitFor();
      await screenshotPage(page, "desktop-1440-example-detail-light.png");

      await page.getByLabel("Theme").click();
      await page.getByRole("radio", { name: "Dark" }).click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForHome(page);
      await page.getByLabel("Describe your goal").fill("quantum blockchain");
      await page
        .getByRole("button", { name: "Find matching examples" })
        .click();
      await page.getByText(/No keyword overlap|Weak match/i).waitFor();
      await screenshotPage(page, "desktop-1440-new-dark-no-match.png");

      await routeActiveWorkspace(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForHome(page);
      await page.getByRole("link", { name: "Discover examples" }).waitFor();
      await screenshotPage(page, "desktop-1440-active-dark.png");

      await page.getByRole("button", { name: "Advanced" }).click();
      await page
        .getByRole("link", { name: "Examples Verified osva-examples catalog" })
        .waitFor();
      await screenshotPage(page, "desktop-1440-advanced-dark.png");
      await page
        .getByRole("group", { name: "Home presentation" })
        .getByRole("button", { name: "Standard", exact: true })
        .click();

      await page.unroute("**/api/v1/**");
      await routeEmptyWorkspace(page);
      await page.reload({ waitUntil: "networkidle" });
      await waitForHome(page);

      await page.setViewportSize({ width: 768, height: 1024 });
      await screenshotPage(page, "tablet-768-new-light.png");
      let overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await screenshotPage(page, "mobile-390-new-light.png");
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      await page.getByLabel("Describe your goal").focus();
      await page.keyboard.press("Tab");
      const focusedTag = await page.evaluate(
        () => document.activeElement?.tagName ?? "",
      );
      expect(focusedTag.length).toBeGreaterThan(0);

      await context.close();
    } finally {
      await browser.close();
    }
  });
});
