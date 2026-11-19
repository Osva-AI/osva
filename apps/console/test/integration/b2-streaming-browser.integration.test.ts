import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { Database } from "@osva/db";

import {
  assertNoSentinelLeak,
  consoleJson,
  resetM12_3Data,
  SENTINEL_CREDENTIAL,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  waitForRunSucceeded,
  type M12_3Stack,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import { pollUntil } from "./poll-deadline.js";
import {
  launchStreamingRun,
  loginAndSelectWorkspaceA,
  provisionModelStreamAgent,
  selectWorkspaceB,
} from "./b2-streaming-browser-helpers.js";

async function importChromium(): Promise<typeof import("playwright").chromium> {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for B2 streaming browser acceptance; install root devDependency playwright",
    );
  }
}

async function openLiveStack(
  database: Database,
  postgres: PostgresTestContext,
  valkey: ValkeyTestContext,
): Promise<M12_3Stack> {
  return startM12_3HumanConsoleStack({
    database,
    databaseUrl: postgres.connectionString,
    valkeyUrl: valkey.url,
    runLiveStreamEnabled: true,
    runLiveStreamTextVisible: false,
  });
}

async function assertNoSecretsInPage(page: Page): Promise<void> {
  const html = await page.content();
  expect(html).not.toContain(SENTINEL_CREDENTIAL);
  expect(html.toLowerCase()).not.toContain("session_token");
  expect(await page.getByTestId("run-live-text").count()).toBe(0);
}

async function waitForLiveStatusOnly(page: Page): Promise<void> {
  await page.getByTestId("run-live-output").waitFor({ timeout: 60_000 });
  await pollUntil({
    label: "B2 live status-only panel",
    deadlineMs: 120_000,
    intervalMs: 250,
    probe: async () => {
      const statusOnlyVisible =
        (await page.getByTestId("run-live-status-only").count()) > 0;
      const connecting =
        (await page.getByTestId("run-live-connecting").count()) > 0;
      return {
        done: statusOnlyVisible && !connecting,
        lastState: statusOnlyVisible ? "status-only" : "waiting",
      };
    },
  });
}

async function waitForBffStreamResponse(
  page: Page,
  runId: string,
): Promise<void> {
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes(`/api/v1/runs/${runId}/stream`) &&
      response.status() === 200,
    { timeout: 120_000 },
  );
}

async function openRunDetailForStreamingRun(
  page: Page,
  stack: M12_3Stack,
  fixture: Awaited<ReturnType<typeof provisionModelStreamAgent>>,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const launched = await launchStreamingRun(stack, fixture);

  await pollUntil({
    label: `run ${launched.runId} active for live attach`,
    deadlineMs: 60_000,
    intervalMs: 150,
    probe: async () => {
      const run = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(launched.runId)}`,
      );
      const status = (run.body as { status?: string }).status;
      const active =
        status === "PENDING" || status === "QUEUED" || status === "RUNNING";
      if (status === "FAILED") {
        throw new Error(`run failed before attach: ${run.text.slice(0, 500)}`);
      }
      return { done: active, lastState: status };
    },
  });

  const streamResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response
        .url()
        .includes(
          `/api/v1/runs/${encodeURIComponent(launched.runId)}/stream`,
        ) &&
      response.status() === 200,
    { timeout: 120_000 },
  );

  await page.goto(
    `${stack.consoleOrigin}/runs/${encodeURIComponent(launched.runId)}`,
  );
  await streamResponse;
  return launched;
}

async function waitForRunSucceededStatus(page: Page): Promise<void> {
  await pollUntil({
    label: "B2 run detail succeeded status",
    deadlineMs: 120_000,
    intervalMs: 500,
    probe: async () => {
      await page.getByRole("button", { name: "Refresh" }).click();
      const succeeded =
        (await page.getByRole("status", { name: "Succeeded" }).count()) > 0;
      return { done: succeeded, lastState: succeeded };
    },
  });
}

describe("B2 Console live streaming browser acceptance (Playwright)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("scenario A: authenticated live streaming via Console BFF (status-only)", async () => {
    const chromium = await importChromium();
    const stack = await openLiveStack(database, postgres, valkey);
    const providerCallsBefore = stack.fakeOpenAI.requests.length;

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-a",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        const { runId, runAttemptId } = await openRunDetailForStreamingRun(
          page,
          stack,
          fixture,
        );

        await waitForLiveStatusOnly(page);
        await assertNoSecretsInPage(page);

        const announcement = await page
          .locator("#run-live-output-status")
          .textContent();
        expect(announcement ?? "").not.toHaveLength(0);

        await waitForRunSucceeded(stack, stack.workspaceA, runId);
        await waitForRunSucceededStatus(page);

        expect(stack.fakeOpenAI.requests.length - providerCallsBefore).toBe(1);

        const steps = await consoleJson(
          stack,
          stack.workspaceA,
          `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
        );
        expect(steps.status).toBe(200);
        const modelSteps = (
          (steps.body as { steps: Array<{ kind: string; status: string }> })
            .steps ?? []
        ).filter((step) => step.kind === "MODEL");
        expect(modelSteps.length).toBe(1);
        expect(modelSteps[0]?.status).toBe("SUCCEEDED");

        const usage = await consoleJson(
          stack,
          stack.workspaceA,
          `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/usage`,
        );
        expect(usage.status).toBe(200);
        expect(
          (usage.body as { modelCalls?: number }).modelCalls ?? 0,
        ).toBeGreaterThan(0);
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });

  it("scenario B: status-only mode discloses no model text", async () => {
    const chromium = await importChromium();
    const stack = await openLiveStack(database, postgres, valkey);

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-b",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        const { runId } = await openRunDetailForStreamingRun(
          page,
          stack,
          fixture,
        );
        await waitForLiveStatusOnly(page);

        const html = await page.content();
        expect(html).not.toContain("stream-success-check");
        expect(html).not.toMatch(/toolArguments|tool_args/i);

        await assertNoSecretsInPage(page);
        await waitForRunSucceeded(stack, stack.workspaceA, runId);
        await waitForRunSucceededStatus(page);
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });

  it("scenario C: navigation away does not cancel provider execution", async () => {
    const chromium = await importChromium();
    const stack = await openLiveStack(database, postgres, valkey);
    const providerCallsBefore = stack.fakeOpenAI.requests.length;

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-c",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        const { runId } = await openRunDetailForStreamingRun(
          page,
          stack,
          fixture,
        );
        await page.getByTestId("run-live-output").waitFor({ timeout: 60_000 });

        await page.goto(`${stack.consoleOrigin}/overview`);
        await page.waitForURL(/\/overview/, { timeout: 30_000 });

        await waitForRunSucceeded(stack, stack.workspaceA, runId);
        expect(stack.fakeOpenAI.requests.length - providerCallsBefore).toBe(1);
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });

  it("scenario D: workspace isolation for live stream and run detail", async () => {
    const stack = await openLiveStack(database, postgres, valkey);

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-d",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });
      const { runId } = await launchStreamingRun(stack, fixture);

      const foreignRun = await consoleJson(
        stack,
        stack.workspaceB,
        `/api/v1/runs/${encodeURIComponent(runId)}`,
      );
      expect([403, 404]).toContain(foreignRun.status);
      assertNoSentinelLeak(foreignRun.text);

      const foreignStream = await consoleJson(
        stack,
        stack.workspaceB,
        `/api/v1/runs/${encodeURIComponent(runId)}/stream`,
      );
      expect([403, 404, 502]).toContain(foreignStream.status);
      assertNoSentinelLeak(foreignStream.text);
      expect(foreignStream.text).not.toContain("TEXT_DELTA");

      const chromium = await importChromium();
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        await selectWorkspaceB(page, stack.consoleOrigin);
        await page.goto(
          `${stack.consoleOrigin}/runs/${encodeURIComponent(runId)}`,
        );

        await pollUntil({
          label: "B2 foreign workspace run detail error",
          deadlineMs: 30_000,
          intervalMs: 300,
          probe: async () => {
            const forbidden =
              (await page
                .getByText(/not found|forbidden|access denied/i)
                .count()) > 0 ||
              (await page
                .getByRole("heading", { name: /failed to load/i })
                .count()) > 0;
            return { done: forbidden, lastState: forbidden };
          },
        });
        await assertNoSecretsInPage(page);
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });

  it("scenario E: late attach and reconnect without replay fabrication", async () => {
    const chromium = await importChromium();
    const stack = await openLiveStack(database, postgres, valkey);

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-e",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        const launched = await launchStreamingRun(stack, fixture);
        const { runId } = launched;

        await pollUntil({
          label: "B2 run active before late attach",
          deadlineMs: 45_000,
          probe: async () => {
            const run = await consoleJson(
              stack,
              stack.workspaceA,
              `/api/v1/runs/${encodeURIComponent(runId)}`,
            );
            const status = (run.body as { status?: string }).status;
            const active =
              status === "PENDING" ||
              status === "QUEUED" ||
              status === "RUNNING";
            return { done: active, lastState: status };
          },
        });

        await page.goto(
          `${stack.consoleOrigin}/runs/${encodeURIComponent(runId)}`,
        );
        await waitForBffStreamResponse(page, runId);

        await page.reload();
        await waitForBffStreamResponse(page, runId);

        const gapNote = page.getByText(/does not replay past events/i);
        await pollUntil({
          label: "B2 history gap notice after reload",
          deadlineMs: 60_000,
          intervalMs: 400,
          probe: async () => {
            const visible = (await gapNote.count()) > 0;
            const statusOnly =
              (await page.getByTestId("run-live-status-only").count()) > 0;
            return {
              done: visible || statusOnly,
              lastState: visible ? "gap" : "status-only",
            };
          },
        });

        await assertNoSecretsInPage(page);
        await waitForRunSucceeded(stack, stack.workspaceA, runId);

        const finalRun = await consoleJson(
          stack,
          stack.workspaceA,
          `/api/v1/runs/${encodeURIComponent(runId)}`,
        );
        expect((finalRun.body as { status?: string }).status).toBe("SUCCEEDED");
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });

  it("scenario F: non-streaming terminal run detail regression", async () => {
    const chromium = await importChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      runLiveStreamEnabled: false,
    });

    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-stream-f",
        fixtureFilename: "model-text-agent.ts",
      });
      const { runId, runAttemptId } = await launchStreamingRun(stack, fixture);
      await waitForRunSucceeded(stack, stack.workspaceA, runId);

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await loginAndSelectWorkspaceA(page, stack.consoleOrigin);
        await page.goto(
          `${stack.consoleOrigin}/runs/${encodeURIComponent(runId)}`,
        );

        await page.getByRole("status", { name: "Succeeded" }).waitFor({
          timeout: 60_000,
        });
        expect(await page.getByTestId("run-live-output").count()).toBe(0);
        expect(await page.getByTestId("run-live-unavailable").count()).toBe(0);

        await page
          .getByRole("heading", { name: "Execution timeline" })
          .waitFor({
            timeout: 30_000,
          });

        const steps = await consoleJson(
          stack,
          stack.workspaceA,
          `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
        );
        expect(steps.status).toBe(200);
        expect(
          ((steps.body as { steps: Array<{ kind: string }> }).steps ?? []).map(
            (step) => step.kind,
          ),
        ).toContain("MODEL");
      } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    } finally {
      await stack.close();
    }
  });
});
