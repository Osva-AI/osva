import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  setShellThemePreference,
  startConsolePreviewServer,
  waitForOverview,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-home-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-new-light.png",
  "desktop-1440-returning-light.png",
  "desktop-1440-returning-dark.png",
  "desktop-1440-returning-failed-light.png",
  "desktop-1440-readonly-light.png",
  "desktop-1440-unavailable-light.png",
  "mobile-390-new-light-full.png",
  "mobile-390-returning-light-full.png",
  "mobile-390-unavailable-light-full.png",
] as const;

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function removeStaleEvidence(): void {
  ensureEvidenceDir();
  for (const fileName of REQUIRED_SCREENSHOTS) {
    const filePath = path.join(EVIDENCE_DIR, fileName);
    try {
      unlinkSync(filePath);
    } catch {
      // fresh capture will overwrite if present
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

async function mockHomeEmpty(page: import("playwright").Page) {
  await page.route("**/api/v1/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agents: [] }),
    });
  });
  await page.route("**/api/v1/workflows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workflows: [] }),
    });
  });
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

async function mockHomeReturning(page: import("playwright").Page) {
  await page.route("**/api/v1/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "agent-1",
            workspaceId: "ws-admin",
            key: "support",
            name: "Customer Support Agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/workflows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            id: "wf-1",
            workspaceId: "ws-admin",
            key: "intake",
            name: "Support Intake Flow",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-10T12:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: "run-1",
            agentId: "agent-1",
            status: "SUCCEEDED",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: {},
            createdAt: "2026-01-11T00:00:00.000Z",
            updatedAt: "2026-01-11T00:01:00.000Z",
          },
        ],
      }),
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

async function mockHomeReturningWithFailedRun(page: import("playwright").Page) {
  await mockHomeReturning(page);
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: "run-failed",
            agentId: "agent-1",
            status: "FAILED",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: {},
            createdAt: "2026-01-12T00:00:00.000Z",
            updatedAt: "2026-01-12T00:01:00.000Z",
          },
        ],
      }),
    });
  });
}

async function mockHomeUnavailable(page: import("playwright").Page) {
  await mockHomeEmpty(page);
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "upstream unavailable" }),
    });
  });
}

describe("UX V2 Home browser acceptance", () => {
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

  it("captures Home V2 states and validates primary journeys", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });

      // 1. New workspace — 1440 light
      await assertViewport(page, 1440, 900);
      await mockHomeEmpty(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      await page.getByRole("heading", { name: /Build your first/i }).waitFor();
      await page.getByRole("link", { name: "Start guided setup" }).waitFor();
      await page.getByRole("link", { name: /Explore agents/i }).waitFor();
      expect(await page.getByText("0 agents").count()).toBe(0);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-new-light.png");

      // 2. Returning — agent + workflow, no failed runs
      await mockHomeReturning(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: /Pick up where you left off/i })
        .waitFor();
      await page.getByText("Support Intake Flow").waitFor();
      await page.getByText("Customer Support Agent").waitFor();
      expect(await page.getByText(/recent run didn't finish/i).count()).toBe(0);
      await page.locator(".home-v2-return-grid").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-returning-light.png");

      // 4. Returning with failed run
      await mockHomeReturningWithFailedRun(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page.getByText(/recent run didn't finish/i).waitFor();
      await page.getByText(/Needs review · Failed/).waitFor();
      expect(
        await page.locator(".home-v2-attention-inline-detail").getByText(/status FAILED/i).count(),
      ).toBe(0);
      const reviewRun = page.getByRole("link", { name: "Review run" }).first();
      await reviewRun.waitFor();
      expect(await reviewRun.getAttribute("href")).toMatch(/\/runs\/run-failed/);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-returning-failed-light.png");

      // 3. Returning dark (reset fixtures — no failed run)
      await mockHomeReturning(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page.getByText("Support Intake Flow").waitFor();
      await page.getByLabel("Theme").waitFor();
      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-returning-dark.png");

      // 6. Unavailable (light)
      await setShellThemePreference(page, "light");
      await mockHomeUnavailable(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: /couldn't load your workspace\./i })
        .waitFor();
      await page.getByRole("button", { name: /Try again/i }).waitFor();
      expect(await page.getByText("Partial data").count()).toBe(0);
      await page.getByText("Technical details").waitFor();
      expect(await page.getByText("0 agents").count()).toBe(0);
      expect(
        await page.getByRole("heading", { name: /Build your first/i }).count(),
      ).toBe(0);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-unavailable-light.png");

      // 5. Read-only new home
      await installMockConsoleApi(page, {
        workspaces: [
          { workspaceId: "ws-admin", name: "Acme Admin", role: "VIEWER" },
        ],
      });
      await mockHomeEmpty(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: /Explore agents/i }).waitFor();
      expect(
        await page.getByRole("link", { name: "Create agent" }).count(),
      ).toBe(0);
      expect(
        await page.getByRole("link", { name: "Create directly" }).count(),
      ).toBe(0);
      await assertNoHorizontalOverflow(page);
      await capture(page, "desktop-1440-readonly-light.png");

      // 7. Mobile new
      await installMockConsoleApi(page);
      await assertViewport(page, 390, 844);
      await mockHomeEmpty(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await waitForOverview(page);
      await page.getByRole("heading", { name: /Build your first/i }).waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "mobile-390-new-light-full.png");

      // 8. Mobile returning
      await mockHomeReturning(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page.getByText("Support Intake Flow").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "mobile-390-returning-light-full.png");

      // 9. Mobile unavailable
      await mockHomeUnavailable(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: /couldn't load your workspace\./i })
        .waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(page, "mobile-390-unavailable-light-full.png");

      await mockHomeEmpty(page);
      await page.goto(`${origin}/overview`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Start guided setup" }).click();
      await page.waitForURL(/\/onboarding/);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
