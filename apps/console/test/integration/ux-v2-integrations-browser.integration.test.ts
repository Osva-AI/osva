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
  "ux-v2-integrations-browser",
);

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function seedIntegrationsWorkspace(
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

async function readThemeTokens(page: import("playwright").Page): Promise<{
  readonly theme: string;
  readonly surfaceCanvas: string;
}> {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme ?? "",
      surfaceCanvas: rootStyle.getPropertyValue("--surface-canvas").trim(),
    };
  });
}

async function mockIntegrationsApi(page: import("playwright").Page) {
  await page.route("**/api/v1/tools**", async (route) => {
    const url = route.request().url();
    if (url.includes("/versions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "tv-mock-1",
              toolId: "tool-mock-1",
              version: 1,
              type: "MCP",
              implementation: "MCP_V1",
              mcp: {
                connectorVersionId: "cv-mock-1",
                remoteToolName: "search",
                inputSchema: { type: "object" },
              },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (url.match(/\/api\/v1\/tools\/[^/]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "tool-mock-1",
          workspaceId: "ws-browser",
          key: "search",
          name: "Search tool",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tools: [
          {
            id: "tool-mock-1",
            workspaceId: "ws-browser",
            key: "search",
            name: "Search tool",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/connectors**", async (route) => {
    const url = route.request().url();
    if (url.includes("/versions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "cv-mock-1",
              connectorId: "conn-mock-1",
              version: 1,
              kind: "MCP",
              transport: "STREAMABLE_HTTP",
              transportConfig: { endpointUrl: "https://mcp.example/mcp" },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (url.match(/\/api\/v1\/connectors\/[^/]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "conn-mock-1",
          workspaceId: "ws-browser",
          key: "browser-mcp",
          name: "Browser MCP",
          description: "Mock connector",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connectors: [
          {
            id: "conn-mock-1",
            workspaceId: "ws-browser",
            key: "browser-mcp",
            name: "Browser MCP",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
}

describe("UX V2 Integrations browser acceptance", () => {
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

  it("captures integrations layouts with theme and responsive checks", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await mockIntegrationsApi(page);
      await seedIntegrationsWorkspace(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/tools`, { waitUntil: "networkidle" });
      await page.getByTestId("integrations-tools-page").waitFor({
        timeout: 30_000,
      });
      const lightTokens = await readThemeTokens(page);
      expect(lightTokens.theme).toBe("light");
      const lightPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-tools-registry-light.png",
      );
      await page.screenshot({ path: lightPath, fullPage: true });

      await page.goto(`${origin}/tools/connectors`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("integrations-connectors-page").waitFor();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "desktop-1440-connectors-light.png"),
        fullPage: true,
      });

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.goto(`${origin}/tools`, { waitUntil: "networkidle" });
      await page.getByTestId("integrations-tools-page").waitFor();
      const darkTokens = await readThemeTokens(page);
      expect(darkTokens.theme).toBe("dark");
      expect(darkTokens.surfaceCanvas).not.toBe(lightTokens.surfaceCanvas);
      const darkPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-tools-registry-dark.png",
      );
      await page.screenshot({ path: darkPath, fullPage: true });
      expect(fileSha256(darkPath)).not.toBe(fileSha256(lightPath));

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/tools`, { waitUntil: "networkidle" });
        await assertNoHorizontalOverflow(page);
        await page.goto(`${origin}/tools/connectors`, {
          waitUntil: "networkidle",
        });
        await assertNoHorizontalOverflow(page);
        await page.goto(`${origin}/tools/tool-mock-1`, {
          waitUntil: "networkidle",
        });
        await assertNoHorizontalOverflow(page);
        await page.goto(`${origin}/tools/connectors/conn-mock-1`, {
          waitUntil: "networkidle",
        });
        await assertNoHorizontalOverflow(page);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/tools`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "mobile-390-tools-registry-light.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 180_000);
});
