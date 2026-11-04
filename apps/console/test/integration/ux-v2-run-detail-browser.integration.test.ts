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

import { routeAgentStudioRunDetail } from "./agent-studio-v2-browser-helpers.js";
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
  "ux-v2-run-detail-browser",
);

const REQUIRED_SCREENSHOTS = [
  "desktop-1440-run-running-light.png",
  "desktop-1440-run-success-light.png",
  "desktop-1440-run-failed-light.png",
  "desktop-1440-run-multiple-attempts.png",
  "desktop-1440-run-dark.png",
  "desktop-1440-run-output-artifacts.png",
  "tablet-768-run-light.png",
  "mobile-390-run-success-light.png",
  "mobile-390-run-failed-light.png",
  "mobile-390-run-dark.png",
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

function studioAttemptId(runId: string): string {
  return `${runId}-attempt-1`;
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

async function assertDomOrderBefore(
  page: import("playwright").Page,
  earlierTestId: string,
  laterSelector: string,
): Promise<void> {
  const order = await page.evaluate(
    ({ testId, laterSel }) => {
      const earlier = document.querySelector(`[data-testid="${testId}"]`);
      const later =
        document.querySelector(laterSel) ??
        Array.from(document.querySelectorAll("h2")).find(
          (node) => node.textContent?.trim() === "Results",
        );
      if (earlier === null || later === null || later === undefined) {
        return null;
      }
      const following = Node.DOCUMENT_POSITION_FOLLOWING;
      return (earlier.compareDocumentPosition(later) & following) === following;
    },
    { testId: earlierTestId, laterSel: laterSelector },
  );
  expect(order).toBe(true);
}

async function assertNoHorizontalOverflow(
  page: import("playwright").Page,
): Promise<void> {
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );
}

async function routeRunWithArtifacts(
  page: import("playwright").Page,
  runId: string,
): Promise<void> {
  const attemptId = studioAttemptId(runId);
  await routeAgentStudioRunDetail(page, runId, {
    runStatus: "SUCCEEDED",
    attemptStatus: "SUCCEEDED",
  });

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attemptId}/usage`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          modelCalls: 1,
          toolCalls: 0,
          inputTokens: 80,
          outputTokens: 40,
          totalTokens: 120,
          cachedInputTokens: 0,
          estimatedCostUsdMicros: 1500,
          pricedModelCalls: 1,
          unpricedModelCalls: 0,
        }),
      });
    },
  );

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attemptId}/steps`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          steps: [
            {
              id: "step-1",
              kind: "MODEL",
              bindingName: "primary",
              status: "SUCCEEDED",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:00:00.500Z",
              modelProfileVersionId: "mpv-1",
              totalTokens: 120,
              estimatedCostUsdMicros: 1500,
            },
          ],
        }),
      });
    },
  );

  await page.route("**/api/v1/artifacts?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "artifact-run-md",
            name: "summary.md",
            mediaType: "text/markdown",
            sizeBytes: 128,
            digest: `sha256:${"b".repeat(64)}`,
            createdAt: "2026-01-01T00:00:01.000Z",
            producer: { runId, runAttemptId: attemptId },
          },
        ],
      }),
    });
  });
}

async function routeMultipleAttempts(
  page: import("playwright").Page,
  runId: string,
): Promise<void> {
  await routeAgentStudioRunDetail(page, runId, {
    runStatus: "RUNNING",
    attemptStatus: "RUNNING",
  });

  await page.route(`**/api/v1/runs/${runId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: runId,
        agentId: "agent-studio-v2",
        status: "RUNNING",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        input: { prompt: "retry after failure" },
        effectiveBindings: {
          agentVersionId: "av-studio-v2",
          modelProfileVersionBindings: [],
          toolVersionBindings: [],
        },
      }),
    });
  });

  await page.route(`**/api/v1/runs/${runId}/attempts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attempts: [
          {
            id: `${runId}-attempt-1`,
            runId,
            sequence: 1,
            status: "FAILED",
            createdAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: `${runId}-attempt-2`,
            runId,
            sequence: 2,
            status: "RUNNING",
            createdAt: "2026-01-01T00:00:02.000Z",
            startedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      }),
    });
  });

  const attempt2 = `${runId}-attempt-2`;
  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attempt2}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: attempt2,
          runId,
          sequence: 2,
          status: "RUNNING",
          createdAt: "2026-01-01T00:00:02.000Z",
          startedAt: "2026-01-01T00:00:02.000Z",
          execution: {
            state: "running_leased",
            leased: true,
            executionGeneration: 1,
            interrupted: false,
            observedAt: "2026-01-01T00:00:03.000Z",
          },
        }),
      });
    },
  );

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attempt2}/steps`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ steps: [] }),
      });
    },
  );

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attempt2}/usage`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          modelCalls: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          estimatedCostUsdMicros: null,
          pricedModelCalls: 0,
          unpricedModelCalls: 0,
        }),
      });
    },
  );
}

describe("UX V2 Run Detail browser acceptance", () => {
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

  it("captures Run Detail V2 states", async () => {
    const captureEpochMs = Date.now();
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const capturedPaths: string[] = [];

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });

      await page.setViewportSize({ width: 1440, height: 900 });

      await routeAgentStudioRunDetail(page, "run-v2-running", {
        runStatus: "RUNNING",
        attemptStatus: "RUNNING",
      });
      await page.goto(`${origin}/runs/run-v2-running`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("run-detail-v2").waitFor();
      await page.getByText(/Execution in progress/i).waitFor();
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-run-running-light.png",
          captureEpochMs,
        ),
      );

      await routeAgentStudioRunDetail(page, "run-v2-success", {
        runStatus: "SUCCEEDED",
        attemptStatus: "SUCCEEDED",
      });
      await page.goto(`${origin}/runs/run-v2-success`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Output", exact: true })
        .waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-run-success-light.png",
          captureEpochMs,
        ),
      );

      await routeRunWithArtifacts(page, "run-v2-artifacts");
      await page.goto(`${origin}/runs/run-v2-artifacts`, {
        waitUntil: "networkidle",
      });
      await page.getByText("summary.md").waitFor();
      await page.getByTestId("run-step-timeline").waitFor();
      const usageSummary = page.getByTestId("run-usage-summary");
      await usageSummary.waitFor();
      await usageSummary.getByText("120", { exact: true }).waitFor();
      await usageSummary.getByText("$0.001500").waitFor();
      const usageText = await usageSummary.innerText();
      expect(usageText).toMatch(/Model calls[\s\S]*1/);
      expect(usageText).toMatch(/Total tokens[\s\S]*120/);
      expect(usageText).toContain("$0.001500");
      const timeline = page.getByTestId("run-step-timeline");
      await timeline
        .getByRole("heading", { name: "Model call", exact: true })
        .waitFor();
      await timeline.getByText("120", { exact: true }).waitFor();
      await timeline.getByText("$0.001500").waitFor();
      await page
        .getByRole("button", { name: /Preview summary\.md/i })
        .waitFor();
      await page.getByRole("link", { name: /Download summary\.md/i }).waitFor();
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-run-output-artifacts.png",
          captureEpochMs,
        ),
      );

      await routeAgentStudioRunDetail(page, "run-v2-failed", {
        runStatus: "FAILED",
        attemptStatus: "FAILED",
      });
      await page.goto(`${origin}/runs/run-v2-failed`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("run-failure-guidance").waitFor();
      await assertDomOrderBefore(
        page,
        "run-failure-guidance",
        "#run-detail-results-title",
      );
      expect(await page.getByTestId("run-lifecycle-guidance").count()).toBe(0);
      const advanced = page.locator("details.run-detail-advanced");
      await advanced.locator("summary").waitFor();
      await page.getByText("RUN_FAILED").first().waitFor({ state: "attached" });
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-run-failed-light.png",
          captureEpochMs,
        ),
      );

      await routeMultipleAttempts(page, "run-v2-attempts");
      await page.goto(
        `${origin}/runs/run-v2-attempts/attempts/run-v2-attempts-attempt-2`,
        {
          waitUntil: "networkidle",
        },
      );
      await page.getByText("Attempt 2").waitFor();
      await page.getByText("In progress").first().waitFor();
      const lifecycle = page.getByTestId("run-lifecycle-guidance");
      await lifecycle.waitFor();
      expect(await lifecycle.innerText()).toMatch(/Execution in progress/i);
      expect(await page.getByTestId("run-failure-guidance").count()).toBe(0);
      const outcome = page.locator(".run-detail-outcome-headline");
      await outcome.getByText("Running", { exact: true }).waitFor();
      const attemptCards = page.locator(".attempt-card");
      await attemptCards.nth(0).getByText("Failed", { exact: true }).waitFor();
      await attemptCards.nth(1).getByText("Running", { exact: true }).waitFor();
      expect(
        await page
          .locator(".attempt-card")
          .filter({ hasText: /Duration[\s\S]*\d{4,}m/ })
          .count(),
      ).toBe(0);
      capturedPaths.push(
        await capture(
          page,
          "desktop-1440-run-multiple-attempts.png",
          captureEpochMs,
        ),
      );

      await routeAgentStudioRunDetail(page, "run-v2-dark", {
        runStatus: "SUCCEEDED",
        attemptStatus: "SUCCEEDED",
      });
      await page.goto(`${origin}/runs/run-v2-dark`, {
        waitUntil: "networkidle",
      });
      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      capturedPaths.push(
        await capture(page, "desktop-1440-run-dark.png", captureEpochMs),
      );

      await setShellThemePreference(page, "light");
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`${origin}/runs/run-v2-success`, {
        waitUntil: "networkidle",
      });
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(page, "tablet-768-run-light.png", captureEpochMs),
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/runs/run-v2-success`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("run-usage-primary").waitFor();
      await page.getByText("More usage details").waitFor();
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(page, "mobile-390-run-success-light.png", captureEpochMs),
      );

      await page.goto(`${origin}/runs/run-v2-failed`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("run-failure-guidance").waitFor();
      await assertDomOrderBefore(
        page,
        "run-failure-guidance",
        "#run-detail-results-title",
      );
      await assertNoHorizontalOverflow(page);
      capturedPaths.push(
        await capture(page, "mobile-390-run-failed-light.png", captureEpochMs),
      );

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(300);
      capturedPaths.push(
        await capture(page, "mobile-390-run-dark.png", captureEpochMs),
      );

      expect(capturedPaths).toHaveLength(REQUIRED_SCREENSHOTS.length);
      for (const fileName of REQUIRED_SCREENSHOTS) {
        const filePath = path.join(EVIDENCE_DIR, fileName);
        expect(statSync(filePath).size).toBeGreaterThan(0);
      }

      const manifest = {
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
            lastModifiedMs: stat.mtimeMs,
            lastModifiedIso: new Date(stat.mtimeMs).toISOString(),
            bytes: stat.size,
            sha256: sha256File(filePath),
            width,
            height,
          };
        }),
      };
      writeFileSync(
        path.join(EVIDENCE_DIR, "capture-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      expect(
        manifest.screenshots.every(
          (s) => s.lastModifiedMs >= captureEpochMs - 2_000,
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
