import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openOnboarding,
  readHorizontalOverflow,
  routeOnboardingConfiguredWorkspace,
  routeOnboardingEmptyWorkspace,
  screenshotOnboarding,
  startConsolePreviewServer,
  waitForOnboarding,
} from "./m18-4-browser-helpers.js";

describe("M18.4 browser acceptance (Unified guided onboarding)", () => {
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

  it("covers guided navigation, roles, resume URL, themes, and responsive layouts", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await routeOnboardingEmptyWorkspace(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openOnboarding(page, origin, { theme: "light" });
      await page.getByTestId("onboarding-primary-step").waitFor();
      await page.getByRole("link", { name: "Configure model" }).waitFor();
      await screenshotOnboarding(page, "desktop-1440-empty-light.png");

      await page.getByRole("link", { name: "Go to Home" }).click();
      await page.getByRole("heading", { name: /Build your first/i }).waitFor();
      await page.getByRole("link", { name: "Start guided setup" }).click();
      await waitForOnboarding(page);

      await routeOnboardingConfiguredWorkspace(page, {
        runStatus: "QUEUED",
        includeRuns: true,
      });
      await page.goto(
        `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1`,
        { waitUntil: "networkidle" },
      );
      await waitForOnboarding(page);
      await page
        .getByTestId("onboarding-primary-step")
        .getByText(/Your test is waiting to start/i)
        .waitFor();
      await screenshotOnboarding(
        page,
        "desktop-1440-configured-queued-light.png",
      );

      await routeOnboardingConfiguredWorkspace(page, {
        runStatus: "SUCCEEDED",
      });
      await page.reload({ waitUntil: "networkidle" });
      await waitForOnboarding(page);
      await page
        .getByRole("heading", { name: /Your first agent test succeeded/i })
        .waitFor();
      await page.getByRole("link", { name: "Open Run output" }).waitFor();
      await screenshotOnboarding(page, "desktop-1440-succeeded-light.png");

      await routeOnboardingConfiguredWorkspace(page, {
        runStatus: "FAILED",
      });
      await page.reload({ waitUntil: "networkidle" });
      await waitForOnboarding(page);
      await page
        .getByTestId("onboarding-primary-step")
        .getByText(/Needs attention/i)
        .waitFor();
      await screenshotOnboarding(page, "desktop-1440-failed-light.png");

      await routeOnboardingEmptyWorkspace(page);
      await page.route("**/api/v1/auth/workspaces", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workspaces: [
              {
                workspaceId: "ws-admin",
                name: "Acme Admin",
                role: "VIEWER",
              },
            ],
          }),
        });
      });
      await openOnboarding(page, origin, { theme: "light" });
      expect(
        await page
          .getByTestId("onboarding-primary-step")
          .getByRole("link")
          .count(),
      ).toBe(0);
      await page
        .getByTestId("onboarding-primary-step")
        .getByText(/requires DEVELOPER, ADMIN, or OWNER/i)
        .waitFor();

      await routeOnboardingConfiguredWorkspace(page, {
        runStatus: "SUCCEEDED",
      });
      await page.goto(
        `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&runId=run-onb-1`,
        { waitUntil: "networkidle" },
      );
      await waitForOnboarding(page);
      await page
        .getByRole("heading", { name: /Your first agent test succeeded/i })
        .waitFor();
      await page.getByLabel("Theme").click();
      await page.getByRole("radio", { name: "Dark" }).click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await screenshotOnboarding(page, "desktop-1440-succeeded-dark.png");

      await page.setViewportSize({ width: 768, height: 900 });
      await screenshotOnboarding(page, "tablet-768-succeeded-dark.png");

      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );
      await screenshotOnboarding(page, "mobile-390-succeeded-dark.png");

      await page.keyboard.press("Tab");
      const focused = await page.evaluate(
        () => document.activeElement?.tagName ?? "",
      );
      expect(focused.length).toBeGreaterThan(0);

      await routeOnboardingEmptyWorkspace(page);
      await openOnboarding(page, origin, {
        query: "?exampleId=not-in-catalog",
        theme: "light",
      });
      await page.getByText(/not in the curated catalog/i).waitFor();

      await routeOnboardingConfiguredWorkspace(page, {
        runStatus: "SUCCEEDED",
      });
      await openOnboarding(page, origin, {
        query: "?agentId=agent-onb-1&agentVersionId=av-wrong&runId=run-onb-1",
      });
      await page.getByTestId("onboarding-primary-step").waitFor();
      expect(
        await page
          .getByRole("heading", { name: /Your first agent test succeeded/i })
          .count(),
      ).toBe(0);
    } finally {
      await browser.close();
    }
  }, 240_000);
});
