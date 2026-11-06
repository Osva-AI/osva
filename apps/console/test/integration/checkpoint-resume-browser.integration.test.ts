import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chromium, type Browser } from "playwright";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

describe("checkpoint resume (Playwright)", () => {
  let browser: Browser;
  let stopPreview: () => Promise<void>;
  let origin: string;

  beforeAll(async () => {
    ({ origin, stop: stopPreview } = await startConsolePreviewServer());
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await stopPreview?.();
  });

  it("shows recovery panel and completes resume for an INTERRUPTED run", async () => {
    const runId = "run-cp-browser-1";
    const page = await browser.newPage();
    await installMockConsoleApi(page, {
      runDetail: {
        runId,
        run: {
          id: runId,
          agentId: "agent-browser-1",
          status: "INTERRUPTED",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:30.000Z",
          input: { prompt: "browser" },
          effectiveBindings: {
            agentVersionId: "av-browser-1",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
        },
        attempts: {
          attempts: [
            {
              id: "ra-interrupted-1",
              runId,
              sequence: 1,
              status: "FAILED",
              createdAt: "2026-01-01T00:00:05.000Z",
              error: {
                code: "EXECUTION_INTERRUPTED",
                message: "lease expired",
              },
            },
          ],
        },
        recovery: {
          runId,
          runStatus: "INTERRUPTED",
          eligible: true,
          blockedOperations: [],
          latestCheckpoint: {
            id: "cp-browser-1",
            sequence: 1,
            cursorPhase: "after_tool",
            checkpointSequence: 1,
            createdAt: "2026-01-01T00:00:10.000Z",
          },
        },
        resumeResponse: {
          runId,
          runAttemptId: "ra-successor-browser-1",
          outcome: "scheduled",
        },
        resumeStatus: 202,
      },
    });
    await seedShellStorage(page, { workspaceId: "ws-admin" });
    await page.goto(`${origin}/runs/${runId}`, { waitUntil: "networkidle" });

    const recoveryPanel = page.getByTestId("run-detail-recovery");
    await recoveryPanel.waitFor({ state: "visible", timeout: 30_000 });
    expect(await recoveryPanel.isVisible()).toBe(true);

    const resumeHint = page.getByText(
      /This run can be resumed from the latest durable checkpoint/i,
    );
    await resumeHint.waitFor({ state: "visible", timeout: 15_000 });
    expect(await resumeHint.isVisible()).toBe(true);

    const resumeBtn = page.getByTestId("run-detail-resume");
    await resumeBtn.click();
    await expect
      .poll(async () => (await resumeBtn.textContent()) ?? "", {
        timeout: 15_000,
        interval: 100,
      })
      .toMatch(/Scheduling/i);

    await page.close();
  }, 120_000);
});
