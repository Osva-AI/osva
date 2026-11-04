import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
  "ux-v2-memory-browser",
);

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const HIDDEN_PAYLOAD = "z".repeat(240);
const SANITIZED_RECORD = { marker: "fixture-only", token: HIDDEN_PAYLOAD };

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function seedMemoryWorkspace(
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
}

async function mockMemoryApi(page: import("playwright").Page): Promise<void> {
  await page.route("**/api/v1/memory/namespaces**", async (route) => {
    const url = route.request().url();
    if (url.includes("/records")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              key: "prefs.theme",
              revision: 3,
              value: SANITIZED_RECORD,
            },
          ],
        }),
      });
      return;
    }
    if (url.match(/\/api\/v1\/memory\/namespaces\/[^/]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ns-mock-1",
          workspaceId: "ws-browser",
          key: "session",
          name: "Session memory",
          description: "Operator session preferences",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "ns-mock-1",
            workspaceId: "ws-browser",
            key: "session",
            name: "Session memory",
            description: "Operator session preferences",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
}

describe("UX V2 Memory browser acceptance", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    ensureEvidenceDir();
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures memory layouts with theme and responsive checks", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await mockMemoryApi(page);
      await seedMemoryWorkspace(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/memory`, { waitUntil: "networkidle" });
      await page.getByTestId("memory-v2-page").waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Refresh" }).waitFor({
        state: "visible",
      });
      const lightTokens = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          theme: document.documentElement.dataset.theme ?? "",
          surfaceCanvas: rootStyle.getPropertyValue("--surface-canvas").trim(),
        };
      });
      expect(lightTokens.theme).toBe("light");
      const lightPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-memory-hub-light.png",
      );
      await page.screenshot({ path: lightPath, fullPage: true });

      await page.goto(`${origin}/memory/namespaces/ns-mock-1`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("memory-namespace-detail-page").waitFor();
      await page.getByText("prefs.theme").waitFor();
      const previewText = await page
        .locator(".memory-v2-value-preview")
        .innerText();
      expect(previewText.includes(HIDDEN_PAYLOAD)).toBe(false);
      expect(previewText.endsWith("…")).toBe(true);
      expect(await page.getByText(HIDDEN_PAYLOAD).isVisible()).toBe(false);

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.goto(`${origin}/memory`, { waitUntil: "networkidle" });
      await page.getByTestId("memory-v2-page").waitFor();
      const darkTokens = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          theme: document.documentElement.dataset.theme ?? "",
          surfaceCanvas: rootStyle.getPropertyValue("--surface-canvas").trim(),
        };
      });
      expect(darkTokens.theme).toBe("dark");
      expect(darkTokens.surfaceCanvas).not.toBe(lightTokens.surfaceCanvas);
      const darkPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-memory-hub-dark.png",
      );
      await page.screenshot({ path: darkPath, fullPage: true });
      expect(fileSha256(darkPath)).not.toBe(fileSha256(lightPath));

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/memory`, { waitUntil: "networkidle" });
        await assertNoHorizontalOverflow(page);
        await page.getByTestId("memory-v2-page").waitFor({ state: "visible" });
        await page.goto(`${origin}/memory/namespaces/ns-mock-1`, {
          waitUntil: "networkidle",
        });
        await assertNoHorizontalOverflow(page);
        await page
          .getByLabel(/Key prefix filter/i)
          .waitFor({ state: "visible" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/memory`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "mobile-390-memory-hub-light.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 180_000);
});
