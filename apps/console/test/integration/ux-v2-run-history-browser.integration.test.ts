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
  routeWorkflowRunV2,
  seedWorkflowV2AgentCatalog,
  workflowNodeRun,
} from "./workflow-run-v2-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-run-history-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-agent-runs-light.png",
  "desktop-1440-agent-runs-dark.png",
  "desktop-1440-agent-runs-filtered.png",
  "desktop-1440-agent-runs-empty.png",
  "desktop-1440-agent-runs-error.png",
  "desktop-1440-agent-runs-pagination.png",
  "mobile-390-agent-runs-light.png",
  "desktop-1440-workflow-runs-light.png",
  "desktop-1440-workflow-runs-dark.png",
  "desktop-1440-workflow-runs-waiting.png",
  "desktop-1440-workflow-runs-filtered-succeeded.png",
  "desktop-1440-workflow-runs-empty.png",
  "mobile-390-workflow-runs-light.png",
  "desktop-1440-viewer-waiting-copy.png",
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

const agentRunsPopulated = [
  {
    id: "run-browser-agent-1",
    agentId: "agent-browser-1",
    status: "RUNNING",
    effectiveBindings: {
      agentVersionId: "av-browser-1",
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
    },
    input: {},
    createdAt: "2026-02-01T12:00:00.000Z",
    updatedAt: "2026-02-01T12:05:00.000Z",
  },
  {
    id: "run-browser-agent-2",
    agentId: "agent-browser-2",
    status: "SUCCEEDED",
    effectiveBindings: {
      agentVersionId: "av-browser-2",
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
    },
    input: {},
    createdAt: "2026-02-01T11:00:00.000Z",
    updatedAt: "2026-02-01T11:30:00.000Z",
  },
];

const workflowRunsPopulated = [
  {
    id: "wr-browser-waiting",
    workspaceId: "ws-admin",
    workflowId: "wf-browser",
    workflowVersionId: "wv-browser",
    status: "WAITING",
    createdAt: "2026-02-01T12:00:00.000Z",
    updatedAt: "2026-02-01T12:01:00.000Z",
  },
  {
    id: "wr-browser-done",
    workspaceId: "ws-admin",
    workflowId: "wf-browser",
    workflowVersionId: "wv-browser",
    status: "SUCCEEDED",
    createdAt: "2026-02-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:30:00.000Z",
  },
];

function workflowRunsListResponse(url: URL): {
  readonly workflowRuns: readonly (typeof workflowRunsPopulated)[number][];
  readonly nextCursor?: string;
} {
  const status = url.searchParams.get("status");
  const filtered =
    status === null || status.length === 0
      ? workflowRunsPopulated
      : workflowRunsPopulated.filter((run) => run.status === status);
  return { workflowRuns: [...filtered] };
}

async function mockAgentRunsRoute(
  page: import("playwright").Page,
  handler: (url: URL) => object | "error",
): Promise<void> {
  await page.route("**/api/v1/runs**", async (route) => {
    const url = new URL(route.request().url());
    const result = handler(url);
    if (result === "error") {
      await route.fulfill({ status: 500, body: "error" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
}

async function mockWorkflowRunsRoute(
  page: import("playwright").Page,
  handler: (url: URL) => object,
): Promise<void> {
  await page.route("**/api/v1/workflow-runs**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(handler(url)),
    });
  });
}

describe("UX V2 Run History browser acceptance", () => {
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

  it("captures agent and workflow history V2 evidence", async () => {
    const captureEpochMs = Date.now();
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const capturedPaths: string[] = [];

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });

      await mockAgentRunsRoute(page, (url) => {
        if (url.searchParams.get("status") === "RUNNING") {
          return { runs: [agentRunsPopulated[0]!] };
        }
        if (url.searchParams.get("cursor") === "page-2") {
          return {
            runs: [
              {
                ...agentRunsPopulated[1]!,
                id: "run-browser-page-2",
                status: "FAILED",
              },
            ],
          };
        }
        return { runs: agentRunsPopulated, nextCursor: "page-2" };
      });

      await assertViewport(page, 1440, 900);
      await page.goto(`${origin}/runs`, { waitUntil: "networkidle" });
      await page.getByTestId("agent-runs-history-page").waitFor();
      await page.getByTestId("agent-runs-history-list").waitFor();
      const agentLink = page
        .getByTestId("agent-runs-history-list")
        .getByRole("link", { name: /Agent run, Running/i })
        .first();
      expect(await agentLink.getAttribute("href")).toBe(
        "/runs/run-browser-agent-1",
      );
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-agent-runs-light.png",
          captureEpochMs,
        ),
      );

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(page, "desktop-1440-agent-runs-dark.png", captureEpochMs),
      );

      await setShellThemePreference(page, "light");
      await page.selectOption("#status-filter", "RUNNING");
      await page.getByTestId("agent-runs-history-list").waitFor();
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-agent-runs-filtered.png",
          captureEpochMs,
        ),
      );

      await mockAgentRunsRoute(page, () => ({ runs: [] }));
      await page.goto(`${origin}/runs`, { waitUntil: "networkidle" });
      await page.getByText("No runs yet.").waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-agent-runs-empty.png",
          captureEpochMs,
        ),
      );

      await mockAgentRunsRoute(page, () => "error");
      await page.goto(`${origin}/runs`, { waitUntil: "networkidle" });
      await page.getByText("Could not load agent runs").waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-agent-runs-error.png",
          captureEpochMs,
        ),
      );

      await mockAgentRunsRoute(page, (url) => {
        if (url.searchParams.get("cursor") === "page-2") {
          return { runs: [{ ...agentRunsPopulated[1]!, id: "run-page-2" }] };
        }
        return { runs: [agentRunsPopulated[0]!], nextCursor: "page-2" };
      });
      await page.goto(`${origin}/runs`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("link", { name: /Succeeded/i }).waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-agent-runs-pagination.png",
          captureEpochMs,
        ),
      );

      await mockAgentRunsRoute(page, () => ({ runs: agentRunsPopulated }));
      await assertViewport(page, 390, 844);
      await page.goto(`${origin}/runs`, { waitUntil: "networkidle" });
      await page.getByTestId("agent-runs-history-list").waitFor();
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(page, "mobile-390-agent-runs-light.png", captureEpochMs),
      );

      await mockWorkflowRunsRoute(page, workflowRunsListResponse);
      await assertViewport(page, 1440, 900);
      await page.goto(`${origin}/workflow-runs`, { waitUntil: "networkidle" });
      await page.getByTestId("workflow-runs-history-page").waitFor();
      await page.locator(".execution-history-v2-row-waiting").first().waitFor();
      expect(
        await page
          .getByTestId("workflow-runs-history-list")
          .getByRole("link", { name: /Workflow run, Waiting/i })
          .first()
          .getAttribute("href"),
      ).toBe("/workflow-runs/wr-browser-waiting");
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-workflow-runs-light.png",
          captureEpochMs,
        ),
      );

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-workflow-runs-dark.png",
          captureEpochMs,
        ),
      );

      await setShellThemePreference(page, "light");
      const waitingFilterRequest = page.waitForRequest(
        (request) =>
          request.url().includes("/api/v1/workflow-runs") &&
          request.url().includes("status=WAITING"),
      );
      await page.selectOption("#wr-status-filter", "WAITING");
      await waitingFilterRequest;
      await page.locator(".execution-history-v2-row-waiting").first().waitFor();
      expect(
        await page
          .getByTestId("workflow-runs-history-list")
          .getByRole("link", { name: /Succeeded/i })
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByTestId("workflow-runs-history-list")
          .getByRole("link", { name: /Waiting/i })
          .count(),
      ).toBe(1);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-workflow-runs-waiting.png",
          captureEpochMs,
        ),
      );

      const succeededFilterRequest = page.waitForRequest(
        (request) =>
          request.url().includes("/api/v1/workflow-runs") &&
          request.url().includes("status=SUCCEEDED"),
      );
      await page.selectOption("#wr-status-filter", "SUCCEEDED");
      await succeededFilterRequest;
      expect(
        await page
          .getByTestId("workflow-runs-history-list")
          .getByRole("link", { name: /Waiting/i })
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByTestId("workflow-runs-history-list")
          .getByRole("link", { name: /Succeeded/i })
          .count(),
      ).toBe(1);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-workflow-runs-filtered-succeeded.png",
          captureEpochMs,
        ),
      );

      await mockWorkflowRunsRoute(page, () => ({ workflowRuns: [] }));
      await page.goto(`${origin}/workflow-runs`, { waitUntil: "networkidle" });
      await page.getByText("No workflow runs yet.").waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-workflow-runs-empty.png",
          captureEpochMs,
        ),
      );

      await mockWorkflowRunsRoute(page, workflowRunsListResponse);
      await assertViewport(page, 390, 844);
      await page.goto(`${origin}/workflow-runs`, { waitUntil: "networkidle" });
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(
          page,
          "mobile-390-workflow-runs-light.png",
          captureEpochMs,
        ),
      );

      await installMockConsoleApi(page, {
        workspaces: [
          { workspaceId: "ws-admin", name: "Acme Admin", role: "VIEWER" },
        ],
      });
      await seedWorkflowV2AgentCatalog(page);
      await routeWorkflowRunV2(page, "wfr-history-viewer", {
        status: "WAITING",
        definition: APPROVAL_DEFINITION,
        nodeRuns: [
          workflowNodeRun("wfr-history-viewer", {
            id: "wn-agent",
            workflowNodeKey: "agent",
            sequence: 1,
            status: "SUCCEEDED",
          }),
          workflowNodeRun("wfr-history-viewer", {
            id: "wn-approval",
            workflowNodeKey: "approval",
            sequence: 2,
            status: "WAITING",
          }),
        ],
        approvalRequests: [
          {
            id: "ar-history",
            workspaceId: "ws-admin",
            workflowRunId: "wfr-history-viewer",
            workflowNodeRunId: "wn-approval",
            status: "PENDING",
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      });
      await page.goto(`${origin}/workflow-runs/wfr-history-viewer`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("workflow-run-waiting-action").waitFor();
      await page
        .getByRole("heading", { name: "Waiting for approval", level: 2 })
        .waitFor();
      expect(await page.getByText("Action required").count()).toBe(0);
      await assertViewport(page, 1440, 900);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-viewer-waiting-copy.png",
          captureEpochMs,
        ),
      );

      const manifest = {
        capturedAt: new Date(captureEpochMs).toISOString(),
        evidenceDir: EVIDENCE_DIR,
        screenshots: capturedPaths.map((filePath) => {
          const fileName = path.basename(filePath);
          const dims = pngDimensions(filePath);
          return {
            fileName,
            filePath,
            width: dims.width,
            height: dims.height,
            sha256: sha256File(filePath),
            lastModifiedMs: statSync(filePath).mtimeMs,
          };
        }),
      };
      writeFileSync(
        path.join(EVIDENCE_DIR, "capture-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      expect(manifest.screenshots.length).toBe(REQUIRED_SCREENSHOTS.length);
    } finally {
      await browser.close();
    }
  });
});
