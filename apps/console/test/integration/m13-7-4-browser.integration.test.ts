import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureConsoleClientDistForBrowserTests } from "./ensure-console-client-dist.js";
import {
  resetM12_3Data,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import type { Database } from "@osva/db";
import { pollUntil } from "./poll-deadline.js";
import {
  loginHumanWorkspaceA,
  loginViewerWorkspaceA,
  provisionViewerInWorkspaceA,
  seedEchoInputAgent,
  seedPublishedEvaluationSuite,
} from "./m13-6-browser-helpers.js";

async function launchChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for M13.7.4 browser acceptance; install root devDependency playwright",
    );
  }
}

describe("M13.7.4 browser acceptance (Batch evaluation launch & results)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ensureConsoleClientDistForBrowserTests();
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 240_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("launches a batch evaluation, completes cases, and persists results", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const { agentId, agentVersionId } = await seedEchoInputAgent(stack);
    const passInput = { message: "hello-eval" };
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-4-${Date.now()}`,
        cases: [
          {
            key: "pass-case",
            input: passInput,
            expected: { echoed: passInput },
          },
          {
            key: "fail-case",
            input: { message: "will-fail" },
            expected: { echoed: { message: "wrong" } },
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(
        `${stack.consoleOrigin}/testing/runs/new?suiteId=${encodeURIComponent(evaluationSuiteId)}&suiteVersionId=${encodeURIComponent(evaluationSuiteVersionId)}&agentId=${encodeURIComponent(agentId)}&agentVersionId=${encodeURIComponent(agentVersionId)}`,
      );
      await page
        .getByRole("heading", { name: "Launch batch evaluation", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.getByRole("button", { name: "Launch evaluation" }).click();
      await page
        .getByRole("heading", { name: "Evaluation run", level: 1 })
        .waitFor({ timeout: 30_000 });

      await pollUntil({
        label: "evaluation run completion",
        deadlineMs: 180_000,
        intervalMs: 1_000,
        probe: async () => {
          const completed = await page
            .getByText("COMPLETED", { exact: true })
            .first()
            .isVisible()
            .catch(() => false);
          return { done: completed, lastState: { completed } };
        },
      });

      await page.getByText("PASS", { exact: true }).first().waitFor({
        timeout: 15_000,
      });
      await page.getByText("FAIL", { exact: true }).first().waitFor({
        timeout: 15_000,
      });

      await page.getByRole("link", { name: "Open Run" }).first().click();
      await page
        .getByRole("heading", { name: "Run", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.goBack();
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByText("PASS", { exact: true }).first().waitFor({
        timeout: 15_000,
      });
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 240_000);

  it("does not allow viewers to launch evaluations", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    await seedEchoInputAgent(stack);
    await seedPublishedEvaluationSuite(stack, {
      suiteKey: `m13-7-4-viewer-${Date.now()}`,
      cases: [
        {
          key: "only-case",
          input: { x: 1 },
          expected: { echoed: { x: 1 } },
        },
      ],
    });
    await provisionViewerInWorkspaceA(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginViewerWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing/runs/new`);
      await page
        .getByRole("heading", { name: "Launch batch evaluation", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(await page.getByText(/cannot EXECUTE evaluations/i).count()).toBe(
        1,
      );
      expect(
        await page.getByRole("button", { name: "Launch evaluation" }).count(),
      ).toBe(0);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 120_000);
});
