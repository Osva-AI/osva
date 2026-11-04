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
  "ux-v2-knowledge-browser",
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

async function seedKnowledgeWorkspace(
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

async function assertPrimaryControlsVisible(
  page: import("playwright").Page,
): Promise<void> {
  await page.getByTestId("knowledge-v2-page").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Refresh" }).waitFor({
    state: "visible",
  });
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

async function mockKnowledgeApi(
  page: import("playwright").Page,
): Promise<void> {
  await page.route("**/api/v1/knowledge-sources**", async (route) => {
    const url = route.request().url();
    if (url.includes("/indexes")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "ki-mock-1",
              workspaceId: "ws-browser",
              knowledgeSourceId: "ks-mock-1",
              status: "READY",
              parserKey: "osva_native_v1",
              parserVersion: "1",
              chunkerKey: "recursive_text_v1",
              chunkerVersion: "1",
              chunkSize: 512,
              chunkOverlap: 64,
              embeddingProvider: "openai",
              embeddingModel: "text-embedding-3-small",
              embeddingDimensions: 1536,
              distanceMetric: "COSINE",
              pipelineFingerprint: "mock-fp",
              attemptCount: 1,
              chunkCount: 12,
              embeddedChunkCount: 12,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              readyAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (url.match(/\/api\/v1\/knowledge-sources\/[^/]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ks-mock-1",
          workspaceId: "ws-browser",
          key: "playbook",
          name: "Playbook",
          artifactId: "art-mock-1",
          attributes: {},
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
            id: "ks-mock-1",
            workspaceId: "ws-browser",
            key: "playbook",
            name: "Playbook",
            artifactId: "art-mock-1",
            attributes: {},
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/artifacts/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/art-mock-1") || url.includes("/art-mock-1")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "art-mock-1",
          name: "Playbook PDF",
          mediaType: "application/pdf",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route("**/api/v1/knowledge/retrieve", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hits: [
          {
            knowledgeChunkId: "kc-1",
            knowledgeIndexId: "ki-mock-1",
            knowledgeSourceId: "ks-mock-1",
            text: "Mock retrieval excerpt for browser acceptance.",
            score: 0.8123,
            attributes: { section: "overview" },
            location: { page: 1, heading: "Overview" },
          },
        ],
      }),
    });
  });
}

describe("UX V2 Knowledge browser acceptance", () => {
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

  it("captures knowledge layouts with theme, retrieval, and responsive checks", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await mockKnowledgeApi(page);
      await seedKnowledgeWorkspace(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
      await page.getByTestId("knowledge-v2-page").waitFor({ timeout: 30_000 });
      await assertPrimaryControlsVisible(page);
      const lightTokens = await readThemeTokens(page);
      expect(lightTokens.theme).toBe("light");
      const lightPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-knowledge-hub-light.png",
      );
      await page.screenshot({ path: lightPath, fullPage: true });

      await page.goto(`${origin}/knowledge/sources/ks-mock-1`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("knowledge-source-detail-page").waitFor();
      await page.getByLabel("Search query").fill("what is osva");
      await page.getByRole("button", { name: "Search" }).click();
      await page
        .getByText("Mock retrieval excerpt")
        .waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: path.join(
          EVIDENCE_DIR,
          "desktop-1440-knowledge-source-retrieval-light.png",
        ),
        fullPage: true,
      });

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
      await page.getByTestId("knowledge-v2-page").waitFor();
      const darkTokens = await readThemeTokens(page);
      expect(darkTokens.theme).toBe("dark");
      expect(darkTokens.surfaceCanvas).not.toBe(lightTokens.surfaceCanvas);
      const darkPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-knowledge-hub-dark.png",
      );
      await page.screenshot({ path: darkPath, fullPage: true });
      expect(fileSha256(darkPath)).not.toBe(fileSha256(lightPath));

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
        await assertNoHorizontalOverflow(page);
        await assertPrimaryControlsVisible(page);
        await page.goto(`${origin}/knowledge/sources/ks-mock-1`, {
          waitUntil: "networkidle",
        });
        await assertNoHorizontalOverflow(page);
        await page.getByLabel("Search query").waitFor({ state: "visible" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/knowledge`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "mobile-390-knowledge-hub-light.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 180_000);
});
