import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  setShellThemePreference,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-activity-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-activity-light.png",
  "desktop-1440-activity-dark.png",
  "desktop-1440-activity-partial-failure.png",
  "desktop-1440-activity-empty.png",
  "tablet-768-activity-light.png",
  "mobile-390-activity-light.png",
  "mobile-390-activity-dark.png",
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

async function assertViewport(
  page: import("playwright").Page,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height });
  const size = page.viewportSize();
  expect(size?.width).toBe(width);
  expect(size?.height).toBe(height);
}

async function assertNoHorizontalOverflow(
  page: import("playwright").Page,
): Promise<void> {
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );
}

async function capture(page: import("playwright").Page, fileName: string) {
  ensureEvidenceDir();
  const filePath = path.join(EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function mockActivityPopulated(page: import("playwright").Page) {
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: "run-browser-agent",
            agentId: "agent-1",
            status: "RUNNING",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/workflow-runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflowRuns: [
          {
            id: "wr-browser-flow",
            workspaceId: "ws-admin",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "WAITING",
            createdAt: "2026-01-04T00:00:00.000Z",
            updatedAt: "2026-01-04T00:00:01.000Z",
          },
        ],
      }),
    });
  });
}

async function mockActivityEmpty(page: import("playwright").Page) {
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [] }),
    });
  });
  await page.route("**/api/v1/workflow-runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workflowRuns: [] }),
    });
  });
}

async function mockActivityPartialFailure(page: import("playwright").Page) {
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "agent runs unavailable" }),
    });
  });
  await page.route("**/api/v1/workflow-runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflowRuns: [
          {
            id: "wr-partial",
            workspaceId: "ws-admin",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "SUCCEEDED",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      }),
    });
  });
}

describe("UX V2 Activity browser acceptance", () => {
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

  it("captures Activity V2 states and validates links", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });

      await assertViewport(page, 1440, 900);
      await mockActivityPopulated(page);
      await page.goto(`${origin}/activity`, { waitUntil: "networkidle" });
      await page.getByTestId("activity-v2-page").waitFor({ timeout: 15_000 });
      await page.getByRole("heading", { name: "Activity", level: 1 }).waitFor();
      await page
        .getByRole("heading", { name: "Recently created runs" })
        .waitFor();
      await page.getByTestId("activity-bounded-footnote").waitFor();
      const workflowDetail = page
        .getByTestId("activity-recent-feed")
        .getByRole("link", { name: /Workflow run, Waiting/i });
      expect(await workflowDetail.getAttribute("href")).toBe(
        "/workflow-runs/wr-browser-flow",
      );
      expect(
        await page
          .getByRole("link", { name: "Agent run history" })
          .getAttribute("href"),
      ).toBe("/runs");
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-activity-light.png");

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-activity-dark.png");

      await setShellThemePreference(page, "light");
      await mockActivityPartialFailure(page);
      await page.goto(`${origin}/activity`, { waitUntil: "networkidle" });
      await page.getByTestId("activity-partial-failure").waitFor();
      await page.getByText("Partial activity data").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-activity-partial-failure.png");

      await mockActivityEmpty(page);
      await page.goto(`${origin}/activity`, { waitUntil: "networkidle" });
      await page.getByText("No recent activity yet.").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-activity-empty.png");

      await mockActivityPopulated(page);
      await page.goto(`${origin}/activity`, { waitUntil: "networkidle" });
      await assertViewport(page, 768, 1024);
      await page.getByTestId("activity-recent-feed").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "tablet-768-activity-light.png");

      await assertViewport(page, 390, 844);
      await assertNoHorizontalOverflow(page);
      await capture(page, "mobile-390-activity-light.png");

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(page);
      await capture(page, "mobile-390-activity-dark.png");
    } finally {
      await browser.close();
    }
  });
});
