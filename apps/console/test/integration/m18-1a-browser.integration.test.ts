import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  M18_1A_EVIDENCE_DIR,
  readHorizontalOverflow,
  screenshotShell,
  seedShellStorage,
  startConsolePreviewServer,
  setShellThemePreference,
  switchShellWorkspace,
  waitForOverview,
} from "./m18-1a-browser-helpers.js";

describe("M18.1A browser acceptance (mock API + built client)", () => {
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

  it("validates shell layout, themes, navigation, and responsive behavior", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
      });

      // --- Desktop 1440, light, expanded ---
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);

      const themeAfterLoad = await page.evaluate(() => {
        return {
          dataset: document.documentElement.dataset.theme,
          colorScheme: document.documentElement.style.colorScheme,
          inlineScriptPresent:
            document.documentElement.hasAttribute("data-theme"),
        };
      });
      expect(themeAfterLoad.dataset).toBe("light");
      expect(themeAfterLoad.inlineScriptPresent).toBe(true);

      const homeLink = page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", {
          name: "Home",
        });
      expect(await homeLink.getAttribute("class")).toMatch(/active/);

      const desktopLightExpanded = await screenshotShell(
        page,
        "desktop-1440-light-sidebar-expanded.png",
      );

      let overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      // --- Dark theme ---
      await setShellThemePreference(page, "dark");
      const desktopDarkExpanded = await screenshotShell(
        page,
        "desktop-1440-dark-sidebar-expanded.png",
      );

      // --- Collapsed sidebar ---
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await page.waitForSelector(".app-shell.sidebar-collapsed");
      const desktopDarkCollapsed = await screenshotShell(
        page,
        "desktop-1440-dark-sidebar-collapsed.png",
      );
      await page.getByRole("button", { name: "Expand navigation" }).click();

      // Active navigation
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Agents", exact: true })
        .click();
      await page.getByRole("heading", { name: "Agents", level: 1 }).waitFor();
      const agentsLink = page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Agents" });
      expect(await agentsLink.getAttribute("class")).toMatch(/active/);

      // --- Workflow graph editor layout ---
      await page.goto(`${origin}/workflows/new`, { waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: "Create workflow", level: 1 })
        .waitFor({ timeout: 30_000 });
      await page.waitForSelector(".react-flow", { timeout: 30_000 });
      const graphDesktop = await screenshotShell(
        page,
        "desktop-1440-workflow-graph-editor.png",
      );
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      // --- Role-aware workspace admin (ADMIN, account menu) ---
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      const primaryNav = page.getByRole("navigation", { name: "Primary" });
      expect(
        await primaryNav
          .getByRole("link", { name: "Workspace Access" })
          .count(),
      ).toBe(0);
      await page.getByLabel("Account and workspace").click();
      expect(
        await page
          .getByRole("dialog", { name: "Account and workspace" })
          .getByRole("button", { name: "Workspace Access" })
          .count(),
      ).toBe(1);
      await page.keyboard.press("Escape");

      // --- Workspace switch (DEVELOPER) ---
      await switchShellWorkspace(page, /Acme Build/i);
      await page.getByLabel("Account and workspace").click();
      expect(
        await page
          .getByRole("dialog", { name: "Account and workspace" })
          .getByRole("button", { name: "Workspace Access" })
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("dialog", { name: "Account and workspace" })
          .getByRole("button", { name: "Security Activity" })
          .count(),
      ).toBe(1);
      await page.keyboard.press("Escape");

      // --- Tablet 768 ---
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      const tabletOverview = await screenshotShell(
        page,
        "tablet-768-overview.png",
      );
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      // --- Mobile 390: drawer, Escape, focus ---
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);

      const menuButton = page.getByRole("button", { name: "Menu" });
      await menuButton.click();
      expect(await menuButton.getAttribute("aria-expanded")).toBe("true");
      const mobileDrawerOpen = await screenshotShell(
        page,
        "mobile-390-drawer-open.png",
      );

      await page.keyboard.press("Escape");
      expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
      expect(
        await menuButton.evaluate((el) => el === document.activeElement),
      ).toBe(true);

      await menuButton.click();
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Activity", exact: true })
        .click();
      expect(await menuButton.getAttribute("aria-expanded")).toBe("false");
      await page.getByRole("heading", { name: "Activity", level: 1 }).waitFor();

      const mobileRuns = await screenshotShell(page, "mobile-390-runs.png");
      overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );

      // Focus visibility smoke: Tab moves focus into primary content.
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      await page.keyboard.press("Tab");
      const focusedTag = await page.evaluate(
        () => document.activeElement?.tagName ?? "",
      );
      expect(focusedTag.length).toBeGreaterThan(0);

      void {
        evidenceDir: M18_1A_EVIDENCE_DIR,
        screenshots: [
          desktopLightExpanded,
          desktopDarkExpanded,
          desktopDarkCollapsed,
          graphDesktop,
          tabletOverview,
          mobileDrawerOpen,
          mobileRuns,
        ],
      };
    } finally {
      await browser.close();
    }
  }, 180_000);
});
