import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  setShellThemePreference,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";
import {
  APPROVAL_DEFINITION,
  BRANCH_DEFINITION,
  EVENT_WAIT_DEFINITION,
  PARALLEL_JOIN_DEFINITION,
  routeWorkflowRunV2,
  seedWorkflowV2AgentCatalog,
  succeededApprovalPathNodeRuns,
  workflowNodeRun,
} from "./workflow-run-v2-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-workflow-run-detail-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-workflow-running-light.png",
  "desktop-1440-workflow-wait-approval.png",
  "desktop-1440-workflow-wait-event.png",
  "desktop-1440-workflow-parallel-join.png",
  "desktop-1440-workflow-branch.png",
  "desktop-1440-workflow-succeeded.png",
  "desktop-1440-workflow-failed.png",
  "desktop-1440-workflow-dark.png",
  "tablet-768-workflow-light.png",
  "mobile-390-workflow-wait-approval.png",
  "mobile-390-workflow-failed.png",
  "mobile-390-workflow-dark.png",
] as const;

function removeStaleEvidence(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const fileName of REQUIRED_SCREENSHOTS) {
    try {
      unlinkSync(path.join(EVIDENCE_DIR, fileName));
    } catch {
      // overwrite on capture
    }
  }
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function pngDimensions(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function capture(
  page: import("playwright").Page,
  fileName: string,
  captureEpochMs: number,
): Promise<string> {
  const filePath = path.join(EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  const stat = statSync(filePath);
  expect(stat.size).toBeGreaterThan(0);
  expect(stat.mtimeMs).toBeGreaterThanOrEqual(captureEpochMs - 2_000);
  return filePath;
}

async function assertNoHorizontalOverflow(
  page: import("playwright").Page,
): Promise<void> {
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );
}

async function openRun(
  page: import("playwright").Page,
  origin: string,
  runId: string,
): Promise<void> {
  await page.goto(`${origin}/workflow-runs/${runId}`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("workflow-run-detail-v2").waitFor();
}

describe("UX V2 Workflow Run Detail browser acceptance", () => {
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

  it("captures Workflow Run Detail V2 states", async () => {
    const captureEpochMs = Date.now();
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedWorkflowV2AgentCatalog(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
      await page.setViewportSize({ width: 1440, height: 900 });

      await routeWorkflowRunV2(page, "wfr-v2-running", {
        status: "RUNNING",
        definition: APPROVAL_DEFINITION,
        nodeRuns: [
          {
            id: "wn-1",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-running",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "RUNNING",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-running");
      await page.getByText("Running", { exact: true }).first().waitFor();
      await page.getByTestId("workflow-graph-view").waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(
        page,
        "desktop-1440-workflow-running-light.png",
        captureEpochMs,
      );

      await routeWorkflowRunV2(page, "wfr-v2-approval", {
        status: "WAITING",
        definition: APPROVAL_DEFINITION,
        nodeRuns: [
          {
            id: "wn-a",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-approval",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "SUCCEEDED",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "wn-ap",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-approval",
            workflowNodeKey: "approval",
            sequence: 2,
            status: "WAITING",
            input: {},
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
        approvalRequests: [
          {
            id: "ar-v2",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-approval",
            workflowNodeRunId: "wn-ap",
            status: "PENDING",
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-approval");
      await page.getByTestId("workflow-run-waiting-action").waitFor();
      await page
        .getByTestId("workflow-run-waiting-action")
        .getByRole("button", { name: "Approve" })
        .waitFor();
      await capture(
        page,
        "desktop-1440-workflow-wait-approval.png",
        captureEpochMs,
      );

      await routeWorkflowRunV2(page, "wfr-v2-event", {
        status: "WAITING",
        definition: EVENT_WAIT_DEFINITION,
        nodeRuns: [
          {
            id: "wn-ev",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-event",
            workflowNodeKey: "wait-event",
            sequence: 1,
            status: "WAITING",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-event");
      await page.getByTestId("workflow-run-waiting-action").waitFor();
      await page.getByText("billing / invoice.paid").waitFor();
      await page
        .getByTestId("workflow-run-waiting-action")
        .getByRole("button", { name: "Emit event" })
        .waitFor();
      await capture(
        page,
        "desktop-1440-workflow-wait-event.png",
        captureEpochMs,
      );

      await routeWorkflowRunV2(page, "wfr-v2-parallel", {
        status: "RUNNING",
        definition: PARALLEL_JOIN_DEFINITION,
        nodeRuns: [
          workflowNodeRun("wfr-v2-parallel", {
            id: "wn-fork",
            workflowNodeKey: "fork",
            sequence: 1,
            status: "SUCCEEDED",
          }),
          workflowNodeRun("wfr-v2-parallel", {
            id: "wn-left",
            workflowNodeKey: "left",
            sequence: 2,
            status: "SUCCEEDED",
          }),
          workflowNodeRun("wfr-v2-parallel", {
            id: "wn-right",
            workflowNodeKey: "right",
            sequence: 3,
            status: "RUNNING",
          }),
        ],
      });
      await openRun(page, origin, "wfr-v2-parallel");
      await page.getByTestId("workflow-graph-view").waitFor();
      await capture(
        page,
        "desktop-1440-workflow-parallel-join.png",
        captureEpochMs,
      );

      await routeWorkflowRunV2(page, "wfr-v2-branch", {
        status: "SUCCEEDED",
        definition: BRANCH_DEFINITION,
        nodeRuns: [
          {
            id: "wn-route",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-branch",
            workflowNodeKey: "route",
            sequence: 1,
            status: "SUCCEEDED",
            selectedTargetKey: "a",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "wn-a",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-branch",
            workflowNodeKey: "a",
            sequence: 2,
            status: "SUCCEEDED",
            input: {},
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
          {
            id: "wn-b",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-branch",
            workflowNodeKey: "b",
            sequence: 3,
            status: "SKIPPED",
            input: {},
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
        output: { branch: "a" },
      });
      await openRun(page, origin, "wfr-v2-branch");
      await page.getByText("Succeeded", { exact: true }).first().waitFor();
      await capture(page, "desktop-1440-workflow-branch.png", captureEpochMs);

      await routeWorkflowRunV2(page, "wfr-v2-success", {
        status: "SUCCEEDED",
        definition: APPROVAL_DEFINITION,
        nodeRuns: succeededApprovalPathNodeRuns("wfr-v2-success"),
        output: { ok: true },
      });
      await openRun(page, origin, "wfr-v2-success");
      await page.getByText("Echo Browser").first().waitFor();
      await capture(
        page,
        "desktop-1440-workflow-succeeded.png",
        captureEpochMs,
      );

      await routeWorkflowRunV2(page, "wfr-v2-failed", {
        status: "FAILED",
        definition: APPROVAL_DEFINITION,
        error: {
          code: "NODE_FAILED",
          message: "Agent node failed in fixture.",
        },
        nodeRuns: [
          {
            id: "wn-f",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-failed",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "FAILED",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-failed");
      await page.getByTestId("workflow-run-guidance").waitFor();
      await capture(page, "desktop-1440-workflow-failed.png", captureEpochMs);

      await routeWorkflowRunV2(page, "wfr-v2-dark", {
        status: "SUCCEEDED",
        definition: APPROVAL_DEFINITION,
        nodeRuns: succeededApprovalPathNodeRuns("wfr-v2-dark"),
        output: { ok: true },
      });
      await openRun(page, origin, "wfr-v2-dark");
      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await capture(page, "desktop-1440-workflow-dark.png", captureEpochMs);

      await setShellThemePreference(page, "light");
      await page.setViewportSize({ width: 768, height: 1024 });
      await openRun(page, origin, "wfr-v2-success");
      await assertNoHorizontalOverflow(page);
      await capture(page, "tablet-768-workflow-light.png", captureEpochMs);

      await page.setViewportSize({ width: 390, height: 844 });
      await openRun(page, origin, "wfr-v2-approval");
      const actionPanel = page.getByTestId("workflow-run-waiting-action");
      await actionPanel.waitFor();
      const approveBox = await actionPanel.boundingBox();
      const viewport = page.viewportSize();
      expect(approveBox).not.toBeNull();
      if (approveBox !== null && viewport !== null) {
        expect(approveBox.y).toBeLessThan(viewport.height * 0.55);
      }
      await actionPanel.getByRole("button", { name: "Approve" }).waitFor();
      await assertNoHorizontalOverflow(page);
      await capture(
        page,
        "mobile-390-workflow-wait-approval.png",
        captureEpochMs,
      );

      await installMockConsoleApi(page, {
        workspaces: [
          { workspaceId: "ws-admin", name: "Acme Admin", role: "VIEWER" },
        ],
      });
      await seedWorkflowV2AgentCatalog(page);
      await routeWorkflowRunV2(page, "wfr-v2-approval", {
        status: "WAITING",
        definition: APPROVAL_DEFINITION,
        nodeRuns: [
          workflowNodeRun("wfr-v2-approval", {
            id: "wn-a",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "SUCCEEDED",
          }),
          workflowNodeRun("wfr-v2-approval", {
            id: "wn-ap",
            workflowNodeKey: "approval",
            sequence: 2,
            status: "WAITING",
          }),
        ],
        approvalRequests: [
          {
            id: "ar-v2",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-approval",
            workflowNodeRunId: "wn-ap",
            status: "PENDING",
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-approval");
      await actionPanel.waitFor();
      expect(
        await actionPanel.getByRole("button", { name: "Approve" }).count(),
      ).toBe(0);
      await page.getByText(/cannot submit approval decisions/i).waitFor();
      await capture(
        page,
        "mobile-390-workflow-viewer-wait.png",
        captureEpochMs,
      );

      await installMockConsoleApi(page);
      await seedWorkflowV2AgentCatalog(page);
      await routeWorkflowRunV2(page, "wfr-v2-failed", {
        status: "FAILED",
        definition: APPROVAL_DEFINITION,
        error: {
          code: "NODE_FAILED",
          message: "Agent node failed in fixture.",
        },
        nodeRuns: [
          {
            id: "wn-f",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-v2-failed",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "FAILED",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      });
      await openRun(page, origin, "wfr-v2-failed");
      await page.getByTestId("workflow-run-guidance").waitFor();
      await capture(page, "mobile-390-workflow-failed.png", captureEpochMs);

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await capture(page, "mobile-390-workflow-dark.png", captureEpochMs);

      for (const fileName of REQUIRED_SCREENSHOTS) {
        expect(
          statSync(path.join(EVIDENCE_DIR, fileName)).size,
        ).toBeGreaterThan(0);
      }

      writeFileSync(
        path.join(EVIDENCE_DIR, "capture-manifest.json"),
        `${JSON.stringify(
          {
            captureEpochMs,
            captureCompletedAt: new Date().toISOString(),
            evidenceDir: path.resolve(EVIDENCE_DIR),
            screenshots: REQUIRED_SCREENSHOTS.map((fileName) => {
              const filePath = path.join(EVIDENCE_DIR, fileName);
              const stat = statSync(filePath);
              const { width, height } = pngDimensions(filePath);
              return {
                fileName,
                absolutePath: path.resolve(filePath),
                lastModifiedIso: new Date(stat.mtimeMs).toISOString(),
                bytes: stat.size,
                sha256: sha256File(filePath),
                width,
                height,
              };
            }),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } finally {
      await browser.close();
    }
  });
});
