import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const MISSION_FIXTURE = {
  id: "goal-m22-3",
  workspaceId: "ws-admin",
  key: "m22-3",
  title: "Acceptance mission",
  status: "OPEN",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const WORKER_FIXTURE = {
  id: "ow-m22-3",
  workspaceId: "ws-admin",
  key: "writer",
  name: "Writer",
  agentId: "agent-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const TASK_FIXTURE = {
  id: "asn-m22-3",
  workspaceId: "ws-admin",
  goalId: MISSION_FIXTURE.id,
  officeWorkerId: WORKER_FIXTURE.id,
  title: "Board task",
  targetType: "AGENT_VERSION",
  targetVersionId: "av-1",
  input: {},
  status: "RUNNING",
  runId: "run-m22-3",
  createdAt: "2026-01-02T00:00:00.000Z",
  startedAt: "2026-01-02T00:01:00.000Z",
};

describe("M22.3 Tasks and Missions browser UI", () => {
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

  async function installTasksMocks(page: import("playwright").Page) {
    await installMockConsoleApi(page);
    await page.route("**/api/v1/office/**", async (route) => {
      const url = new URL(route.request().url());
      const { pathname } = url;
      const method = route.request().method();
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });

      if (pathname === "/api/v1/office/goals" && method === "GET") {
        await json({ items: [MISSION_FIXTURE] });
        return;
      }
      if (
        pathname ===
          `/api/v1/office/goals/${encodeURIComponent(MISSION_FIXTURE.id)}` &&
        method === "GET"
      ) {
        await json(MISSION_FIXTURE);
        return;
      }
      if (pathname === "/api/v1/office/workers" && method === "GET") {
        await json({ items: [WORKER_FIXTURE] });
        return;
      }
      if (pathname === "/api/v1/office/assignments" && method === "GET") {
        await json({ items: [TASK_FIXTURE] });
        return;
      }
      if (
        pathname ===
          `/api/v1/office/assignments/${encodeURIComponent(TASK_FIXTURE.id)}` &&
        method === "GET"
      ) {
        await json(TASK_FIXTURE);
        return;
      }
      if (pathname === "/api/v1/office/teams" && method === "GET") {
        await json({ items: [] });
        return;
      }
      if (pathname === "/api/v1/office/roles" && method === "GET") {
        await json({ items: [] });
        return;
      }
      await json({ error: "not mocked" }, 404);
    });
  }

  it("navigates missions, task board filters, and task detail", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installTasksMocks(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
      });

      await page.setViewportSize({ width: 1440, height: 900 });

      await page.goto(`${origin}/office/missions`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("heading", { name: "Missions" }).waitFor();
      await page.getByRole("link", { name: MISSION_FIXTURE.title }).click();
      await page
        .getByRole("heading", { name: MISSION_FIXTURE.title })
        .waitFor();

      await page.goto(`${origin}/office/tasks`, { waitUntil: "networkidle" });
      await page.getByTestId("office-tasks-board-page").waitFor();
      await page.getByRole("link", { name: TASK_FIXTURE.title }).waitFor();

      await page.getByLabel("Status").selectOption("RUNNING");
      await page.getByRole("link", { name: TASK_FIXTURE.title }).waitFor();

      await page.getByRole("link", { name: TASK_FIXTURE.title }).click();
      await page.getByRole("heading", { name: TASK_FIXTURE.title }).waitFor();
      await page.getByText("RUNNING").first().waitFor();

      const evidenceDir = path.join(
        process.cwd(),
        "artifacts",
        "m22-3-tasks-missions-browser",
      );
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: path.join(evidenceDir, "task-detail.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 120_000);
});
