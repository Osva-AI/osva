import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertMobileNavDrawerVisible,
  expectViewportSize,
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  setShellThemePreference,
  startConsolePreviewServer,
  waitForMobileNavDrawerSettled,
  waitForOverview,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-shell-browser",
);

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function capture(page: import("playwright").Page, fileName: string) {
  ensureEvidenceDir();
  const filePath = path.join(EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

describe("UX V2 shell browser acceptance", () => {
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

  it("captures required shell states from the production React client", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      const desktopLightExpanded = await capture(
        page,
        "desktop-1440-expanded-light.png",
      );

      await page.getByRole("button", { name: "Resources" }).click();
      const resourcesOpen = await capture(
        page,
        "desktop-1440-resources-disclosure-light.png",
      );

      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await page.waitForSelector(".app-shell.sidebar-collapsed");
      const desktopLightCollapsed = await capture(
        page,
        "desktop-1440-collapsed-light.png",
      );

      await page.getByRole("button", { name: "Expand navigation" }).click();

      await page.getByRole("button", { name: "Create", exact: true }).click();
      await capture(page, "desktop-1440-create-menu-light.png");
      await page.keyboard.press("Escape");

      await page.getByLabel("Help").click();
      await capture(page, "desktop-1440-help-menu-light.png");
      await page.keyboard.press("Escape");

      await setShellThemePreference(page, "dark");
      const desktopDarkExpanded = await capture(
        page,
        "desktop-1440-expanded-dark.png",
      );

      await page.getByLabel("Theme").click();
      await capture(page, "desktop-1440-theme-menu-dark.png");
      await page.getByRole("radio", { name: "Dark" }).click();

      await page.getByRole("button", { name: "Account and workspace" }).click();
      await capture(page, "desktop-1440-account-menu.png");
      await page
        .getByRole("button", { name: /Switch/i })
        .first()
        .click();
      await capture(page, "desktop-1440-workspace-switcher.png");
      await page.getByRole("button", { name: /Acme Build/i }).click();

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      await setShellThemePreference(page, "light");
      const desktop1920Light = await capture(
        page,
        "desktop-1920-expanded-light.png",
      );
      await setShellThemePreference(page, "dark");
      const desktop1920Dark = await capture(
        page,
        "desktop-1920-expanded-dark.png",
      );
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await page.waitForSelector(".app-shell.sidebar-collapsed");
      const desktop1920Collapsed = await capture(
        page,
        "desktop-1920-collapsed-dark.png",
      );

      await page.setViewportSize({ width: 1440, height: 900 });
      expectViewportSize(page, 1440, 900);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: true,
      });
      await page.goto(`${origin}/workflows/new`, { waitUntil: "networkidle" });
      expectViewportSize(page, 1440, 900);
      await page.waitForSelector(".app-shell.sidebar-collapsed");
      await page
        .getByRole("heading", { name: "Create workflow", level: 1 })
        .waitFor({ timeout: 30_000 });
      await page.waitForSelector(".react-flow", { timeout: 30_000 });
      const workflowCompact = await capture(
        page,
        "desktop-1440-workflow-compact-rail.png",
      );

      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      const tablet = await capture(page, "tablet-768-overview.png");

      await page.setViewportSize({ width: 390, height: 844 });
      expectViewportSize(page, 390, 844);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: true,
      });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);

      const menuButton = page.getByRole("button", { name: "Menu" });
      await menuButton.click();
      expect(await menuButton.getAttribute("aria-expanded")).toBe("true");
      await waitForMobileNavDrawerSettled(page);
      await assertMobileNavDrawerVisible(page);

      await page.waitForFunction(() => {
        const drawer = document.querySelector(
          '.shell-sidebar-drawer[data-open="true"]',
        );
        return drawer?.contains(document.activeElement) ?? false;
      });

      const mobileNav = await capture(page, "mobile-390-nav-drawer.png");

      await page.keyboard.press("Escape");
      expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
      expect(
        await menuButton.evaluate((el) => el === document.activeElement),
      ).toBe(true);

      await menuButton.click();
      await waitForMobileNavDrawerSettled(page);
      const scrim = page.getByRole("button", { name: "Close navigation" });
      const scrimBox = await scrim.boundingBox();
      if (scrimBox === null) {
        throw new Error("Expected mobile nav scrim to be visible");
      }
      await scrim.click({
        position: {
          x: Math.max(scrimBox.width - 16, scrimBox.width * 0.85),
          y: scrimBox.height / 2,
        },
      });
      expect(await menuButton.getAttribute("aria-expanded")).toBe("false");

      await menuButton.click();
      await waitForMobileNavDrawerSettled(page);
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Agents", exact: true })
        .click();
      expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
      await page
        .getByRole("heading", { name: "Agents", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      const mobile = await capture(page, "mobile-390-overview.png");

      let overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      await menuButton.click();
      await waitForMobileNavDrawerSettled(page);
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      void {
        evidenceDir: EVIDENCE_DIR,
        screenshots: [
          desktopLightExpanded,
          resourcesOpen,
          desktopLightCollapsed,
          desktopDarkExpanded,
          desktop1920Light,
          desktop1920Dark,
          desktop1920Collapsed,
          workflowCompact,
          tablet,
          mobileNav,
          mobile,
        ],
      };
    } finally {
      await browser.close();
    }
  }, 180_000);
});
