import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "m22-5-office-browser",
);

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

const M22_5_FIXTURE = {
  assignments: [
    {
      id: "asn-m255",
      workspaceId: "ws-admin",
      officeWorkerId: "ow-accept",
      goalId: "goal-1",
      title: "Ship memo",
      targetType: "WORKFLOW_VERSION",
      targetVersionId: "wv-1",
      workflowRunId: "wfr-1",
      input: {},
      status: "COMPLETED",
      createdAt: "2026-01-02T00:00:00.000Z",
      startedAt: "2026-01-02T00:01:00.000Z",
      completedAt: "2026-01-02T00:05:00.000Z",
    },
  ],
  workers: [
    {
      id: "ow-accept",
      workspaceId: "ws-admin",
      key: "writer",
      name: "Writer",
      agentId: "agent-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  goals: [
    {
      id: "goal-1",
      workspaceId: "ws-admin",
      key: "q1",
      title: "Quarterly launch",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  artifacts: {
    items: [
      {
        id: "art-1",
        workspaceId: "ws-admin",
        name: "runtime-artifact.txt",
        mediaType: "text/plain",
        sizeBytes: 24,
        digest: "sha256:00",
        createdAt: "2026-01-02T00:05:00.000Z",
        producer: { runId: "run-1" },
      },
    ],
  },
};

/**
 * Mocked Console API acceptance for M22.5A–C routes. Not full-stack proof;
 * worker/DB integration tests carry execution and provenance evidence.
 */
describe("M22.5 Virtual Office browser UI (mocked APIs)", () => {
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

  async function installM22_5Mocks(page: import("playwright").Page) {
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

      if (pathname === "/api/v1/office/assignments" && method === "GET") {
        await json({ items: M22_5_FIXTURE.assignments });
        return;
      }
      if (pathname === "/api/v1/office/workers" && method === "GET") {
        await json({ items: M22_5_FIXTURE.workers });
        return;
      }
      if (pathname === "/api/v1/office/goals" && method === "GET") {
        await json({ items: M22_5_FIXTURE.goals });
        return;
      }
      if (pathname === "/api/v1/office/teams" && method === "GET") {
        await json({ items: [] });
        return;
      }
      await json({ error: "not mocked" }, 404);
    });
    await page.route("**/api/v1/artifacts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(M22_5_FIXTURE.artifacts),
      });
    });
    await page.route("**/api/v1/workflow-runs/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "wfr-1",
          workspaceId: "ws-admin",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "SUCCEEDED",
          createdAt: "2026-01-02T00:01:00.000Z",
          updatedAt: "2026-01-02T00:05:00.000Z",
          nodeRuns: [
            {
              id: "wnr-1",
              workflowNodeKey: "a",
              childRunId: "run-1",
              status: "SUCCEEDED",
            },
          ],
          approvalRequests: [],
        }),
      });
    });
    await page.route("**/api/v1/workflows/**/versions/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          definition: {
            schemaVersion: "2",
            nodes: [{ key: "a", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
        }),
      });
    });
    await page.route("**/api/v1/agents/*/versions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ versions: [] }),
      });
    });
  }

  it("renders deliverables library with mocked APIs", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installM22_5Mocks(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
      });

      await page.goto(`${origin}/office/deliverables`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("office-deliverables-page").waitFor();
      ensureEvidenceDir();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "deliverables-mock.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 120_000);
});
