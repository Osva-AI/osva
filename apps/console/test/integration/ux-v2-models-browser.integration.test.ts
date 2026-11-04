import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  setShellThemePreference,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-models-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-models-profiles-light.png",
  "desktop-1440-models-connections-light.png",
  "desktop-1440-models-profiles-dark.png",
  "tablet-768-models-profiles-light.png",
  "mobile-390-models-profiles-light.png",
  "mobile-320-models-profiles-light.png",
  "mobile-390-models-profiles-dark.png",
] as const;

const VIEWPORTS = [
  { width: 320, height: 720, label: "mobile-320" },
  { width: 390, height: 844, label: "mobile-390" },
  { width: 768, height: 1024, label: "tablet-768" },
] as const;

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function removeStaleEvidence(): void {
  ensureEvidenceDir();
  for (const fileName of REQUIRED_SCREENSHOTS) {
    try {
      unlinkSync(path.join(EVIDENCE_DIR, fileName));
    } catch {
      // overwrite on capture
    }
  }
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function seedModelsBrowserWorkspace(
  page: import("playwright").Page,
): Promise<void> {
  await page.addInitScript(
    ({ wsId }) => {
      sessionStorage.setItem("osva.console.selectedWorkspaceId", wsId);
    },
    { wsId: "ws-admin" },
  );
}

async function assertNoHorizontalOverflow(
  page: import("playwright").Page,
): Promise<void> {
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );
}

async function readThemeSurfaceSamples(
  page: import("playwright").Page,
): Promise<{
  readonly theme: string;
  readonly surfaceCanvas: string;
  readonly surfaceElevated: string;
  readonly borderDefault: string;
  readonly textPrimary: string;
}> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    return {
      theme: root.dataset.theme ?? "",
      surfaceCanvas: rootStyle.getPropertyValue("--surface-canvas").trim(),
      surfaceElevated: rootStyle.getPropertyValue("--surface-elevated").trim(),
      borderDefault: rootStyle.getPropertyValue("--border-default").trim(),
      textPrimary: rootStyle.getPropertyValue("--text-primary").trim(),
    };
  });
}

async function assertPanelWithinViewport(
  page: import("playwright").Page,
  selector: string,
): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  if (box === null || viewport === null) {
    return;
  }
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function mockModelsApi(page: import("playwright").Page) {
  await page.route("**/api/v1/model-provider-connections**", async (route) => {
    const url = route.request().url();
    if (url.includes("/versions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "conn-ver-mock-1",
              connectionId: "conn-mock-1",
              version: 1,
              provider: "OPENAI",
              endpoint: { baseUrl: "https://api.example/v1" },
              credential: { configured: true },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          {
            id: "conn-mock-1",
            workspaceId: "ws-browser",
            key: "openai",
            name: "Mock OpenAI",
            provider: "OPENAI",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/model-profiles**", async (route) => {
    const url = route.request().url();
    if (url.includes("/versions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ versions: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modelProfiles: [
          {
            id: "mp-mock-1",
            workspaceId: "ws-browser",
            key: "primary",
            name: "Primary profile",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
}

async function assertModelsRoutesAtViewport(
  page: import("playwright").Page,
  origin: string,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });

  await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
  await page.getByTestId("models-v2-page").waitFor({ timeout: 30_000 });
  await assertNoHorizontalOverflow(page);
  await assertPanelWithinViewport(page, ".models-v2-create-panel");

  await page.goto(`${origin}/models/connections`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("models-connections-page").waitFor({
    timeout: 30_000,
  });
  await assertNoHorizontalOverflow(page);

  await page.goto(`${origin}/models/mp-mock-1`, { waitUntil: "networkidle" });
  await page.getByTestId("models-profile-detail-page").waitFor({
    timeout: 30_000,
  });
  await assertNoHorizontalOverflow(page);

  await page.goto(`${origin}/models/connections/conn-mock-1`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("models-connection-detail-page").waitFor({
    timeout: 30_000,
  });
  await assertNoHorizontalOverflow(page);
}

describe("UX V2 Models browser acceptance", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    removeStaleEvidence();
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures theme-aware evidence and enforces responsive layout", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await mockModelsApi(page);
      await seedModelsBrowserWorkspace(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
      await setShellThemePreference(page, "light");
      await page.waitForTimeout(200);
      await page.getByTestId("models-v2-page").waitFor({ timeout: 30_000 });
      await assertNoHorizontalOverflow(page);
      const lightSamples = await readThemeSurfaceSamples(page);
      expect(lightSamples.theme).toBe("light");
      const lightShotPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-models-profiles-light.png",
      );
      await page.screenshot({ path: lightShotPath, fullPage: true });

      await page.goto(`${origin}/models/connections`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("models-connections-page").waitFor({
        timeout: 30_000,
      });
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: path.join(
          EVIDENCE_DIR,
          "desktop-1440-models-connections-light.png",
        ),
        fullPage: true,
      });

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
      await page.getByTestId("models-v2-page").waitFor({ timeout: 30_000 });
      const darkSamples = await readThemeSurfaceSamples(page);
      expect(darkSamples.theme).toBe("dark");
      expect(darkSamples.surfaceCanvas).not.toBe(lightSamples.surfaceCanvas);
      expect(darkSamples.surfaceElevated).not.toBe(
        lightSamples.surfaceElevated,
      );
      expect(darkSamples.textPrimary).not.toBe(lightSamples.textPrimary);
      const darkShotPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-models-profiles-dark.png",
      );
      await page.screenshot({ path: darkShotPath, fullPage: true });
      expect(fileSha256(darkShotPath)).not.toBe(fileSha256(lightShotPath));

      for (const viewport of VIEWPORTS) {
        await assertModelsRoutesAtViewport(page, origin, viewport);
        if (viewport.label === "tablet-768") {
          await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
          await page.getByTestId("models-v2-page").waitFor();
          await page.screenshot({
            path: path.join(
              EVIDENCE_DIR,
              "tablet-768-models-profiles-light.png",
            ),
            fullPage: true,
          });
        }
        if (viewport.label === "mobile-390") {
          await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
          await page.getByTestId("models-v2-page").waitFor();
          await assertPanelWithinViewport(page, ".models-v2-create-panel");
          await page.screenshot({
            path: path.join(
              EVIDENCE_DIR,
              "mobile-390-models-profiles-light.png",
            ),
            fullPage: true,
          });
        }
        if (viewport.label === "mobile-320") {
          await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
          await page.getByTestId("models-v2-page").waitFor();
          await page.screenshot({
            path: path.join(
              EVIDENCE_DIR,
              "mobile-320-models-profiles-light.png",
            ),
            fullPage: true,
          });
        }
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await page.goto(`${origin}/models`, { waitUntil: "networkidle" });
      await page.getByTestId("models-v2-page").waitFor();
      await assertNoHorizontalOverflow(page);
      const mobileDarkSamples = await readThemeSurfaceSamples(page);
      expect(mobileDarkSamples.theme).toBe("dark");
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "mobile-390-models-profiles-dark.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 180_000);
});
