import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";

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
import {
  assertGateVerdictMatchesPersistedAssessment,
  configureQualityGateRule,
  fetchEvaluationRunDetail,
  launchEvaluationFromPage,
  openEvaluationLaunchPage,
  qualityGatePanel,
  runStatusPanel,
  seedUnpricedGeminiModelTextAgent,
  UNPRICED_GEMINI_MODEL_OUTPUT,
  waitForEvaluationRunStatus,
  waitForGateVerdictLabel,
  evaluationRunIdFromPage,
} from "./m13-7-5-browser-helpers.js";

async function launchChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for M13.7.5 browser acceptance; install root devDependency playwright",
    );
  }
}

async function gateVerdictText(page: Page): Promise<string | undefined> {
  const panel = qualityGatePanel(page);
  const dt = panel.getByText("Gate verdict", { exact: true });
  if (!(await dt.isVisible().catch(() => false))) {
    return undefined;
  }
  const dd = dt.locator("xpath=following-sibling::dd[1]");
  return (await dd.textContent())?.trim();
}

describe("M13.7.5 browser acceptance (Evaluation quality gates)", () => {
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

  it("scenario A: quality gate PASS matches persisted assessment", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const { agentId, agentVersionId } = await seedEchoInputAgent(stack);
    const passInput = { message: "gate-pass" };
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-5-pass-${Date.now()}`,
        cases: [
          {
            key: "pass-case",
            input: passInput,
            expected: { echoed: passInput },
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await openEvaluationLaunchPage(page, stack, {
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
      });
      await configureQualityGateRule(page, {
        metric: "PASS_RATE",
        thresholdDisplay: "100",
      });
      await launchEvaluationFromPage(page);

      await waitForEvaluationRunStatus(page, "COMPLETED");
      await waitForGateVerdictLabel(page, "Pass");

      const runId = evaluationRunIdFromPage(page);
      const detail = await fetchEvaluationRunDetail(stack, runId);
      assertGateVerdictMatchesPersistedAssessment("Pass", detail);
      expect(detail.status).toBe("COMPLETED");
      expect(detail.qualityGate?.assessment?.lifecycleVerdict).toBe("PASS");
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 240_000);

  it("scenario B: quality gate FAIL explains threshold violation while run completes", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const { agentId, agentVersionId } = await seedEchoInputAgent(stack);
    const passInput = { message: "gate-fail-pass" };
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-5-fail-${Date.now()}`,
        cases: [
          {
            key: "pass-case",
            input: passInput,
            expected: { echoed: passInput },
          },
          {
            key: "fail-case",
            input: { message: "gate-fail-miss" },
            expected: { echoed: { message: "wrong" } },
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await openEvaluationLaunchPage(page, stack, {
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
      });
      await configureQualityGateRule(page, {
        metric: "PASS_RATE",
        thresholdDisplay: "100",
      });
      await launchEvaluationFromPage(page);

      await waitForEvaluationRunStatus(page, "COMPLETED");
      await waitForGateVerdictLabel(page, "Fail");

      expect(
        await runStatusPanel(page)
          .getByText("COMPLETED", { exact: true })
          .count(),
      ).toBe(1);
      expect(
        await qualityGatePanel(page)
          .getByText("Threshold violated.")
          .isVisible(),
      ).toBe(true);

      const runId = evaluationRunIdFromPage(page);
      const detail = await fetchEvaluationRunDetail(stack, runId);
      assertGateVerdictMatchesPersistedAssessment("Fail", detail);
      expect(detail.status).toBe("COMPLETED");
      expect(detail.qualityGate?.assessment?.lifecycleVerdict).toBe("PASS");
      expect(
        detail.qualityGate?.assessment?.ruleResults?.some(
          (rule) => rule.reasonCode === "THRESHOLD_VIOLATED",
        ),
      ).toBe(true);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 240_000);

  it("scenario C: cost gate is INDETERMINATE when pricing evidence is incomplete", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      unpricedGemini: true,
    });

    const { agentId, agentVersionId } = await seedUnpricedGeminiModelTextAgent(
      stack,
      `m13-7-5-indet-${Date.now()}`,
    );
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-5-indet-suite-${Date.now()}`,
        cases: [
          {
            key: "model-case",
            input: {},
            expected: UNPRICED_GEMINI_MODEL_OUTPUT,
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await openEvaluationLaunchPage(page, stack, {
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
      });
      await configureQualityGateRule(page, {
        metric: "ESTIMATED_COST_USD_MICROS",
        thresholdDisplay: "1",
      });
      await launchEvaluationFromPage(page);

      await waitForEvaluationRunStatus(page, "COMPLETED");
      await waitForGateVerdictLabel(page, "Indeterminate");

      expect(
        await qualityGatePanel(page)
          .getByText(/unpriced/i)
          .isVisible(),
      ).toBe(true);

      const runId = evaluationRunIdFromPage(page);
      const detail = await fetchEvaluationRunDetail(stack, runId);
      assertGateVerdictMatchesPersistedAssessment("Indeterminate", detail);
      expect((detail.summary?.unpricedModelCalls ?? 0) >= 1).toBe(true);
      expect(
        detail.qualityGate?.assessment?.ruleResults?.some(
          (rule) => rule.reasonCode === "COST_INCONCLUSIVE_UNPRICED",
        ),
      ).toBe(true);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 300_000);

  it("does not show a final gate PASS before the evaluation run completes", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const { agentId, agentVersionId } = await seedEchoInputAgent(stack);
    const passInput = { message: "no-premature-pass" };
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-5-live-${Date.now()}`,
        cases: [
          {
            key: "pass-case",
            input: passInput,
            expected: { echoed: passInput },
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await openEvaluationLaunchPage(page, stack, {
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
      });
      await configureQualityGateRule(page, {
        metric: "PASS_RATE",
        thresholdDisplay: "0",
      });
      await launchEvaluationFromPage(page);

      await pollUntil({
        label: "gate verdict stays non-Pass until run completion",
        deadlineMs: 120_000,
        intervalMs: 250,
        probe: async () => {
          const completed = await runStatusPanel(page)
            .getByText("COMPLETED", { exact: true })
            .isVisible()
            .catch(() => false);
          const gateText = await gateVerdictText(page);
          if (gateText === "Pass" && !completed) {
            throw new Error("Gate verdict showed Pass before run completion.");
          }
          const runningOrPending =
            (await runStatusPanel(page)
              .getByText("RUNNING", { exact: true })
              .isVisible()
              .catch(() => false)) ||
            (await runStatusPanel(page)
              .getByText("PENDING", { exact: true })
              .isVisible()
              .catch(() => false));
          if (completed || runningOrPending) {
            return {
              done: true,
              lastState: completed ? "completed" : (gateText ?? "live"),
            };
          }
          return { done: false, lastState: gateText ?? "waiting" };
        },
      });

      await waitForEvaluationRunStatus(page, "COMPLETED");
      await waitForGateVerdictLabel(page, "Pass");
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 240_000);

  it("persists gate verdict across browser refresh", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const { agentId, agentVersionId } = await seedEchoInputAgent(stack);
    const passInput = { message: "refresh-gate" };
    const { evaluationSuiteId, evaluationSuiteVersionId } =
      await seedPublishedEvaluationSuite(stack, {
        suiteKey: `m13-7-5-refresh-${Date.now()}`,
        cases: [
          {
            key: "pass-case",
            input: passInput,
            expected: { echoed: passInput },
          },
        ],
      });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await openEvaluationLaunchPage(page, stack, {
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
      });
      await configureQualityGateRule(page, {
        metric: "PASS_RATE",
        thresholdDisplay: "100",
      });
      await launchEvaluationFromPage(page);
      await waitForEvaluationRunStatus(page, "COMPLETED");
      await waitForGateVerdictLabel(page, "Pass");

      const runId = evaluationRunIdFromPage(page);
      const beforeRefresh = await fetchEvaluationRunDetail(stack, runId);

      await page.reload();
      await page
        .getByRole("heading", { name: "Evaluation run", level: 1 })
        .waitFor({ timeout: 30_000 });
      await waitForGateVerdictLabel(page, "Pass");

      const afterRefresh = await fetchEvaluationRunDetail(stack, runId);
      expect(afterRefresh.qualityGate?.assessment?.overallVerdict).toBe(
        beforeRefresh.qualityGate?.assessment?.overallVerdict,
      );
      expect(afterRefresh.qualityGate?.assessment?.assessedAt).toBe(
        beforeRefresh.qualityGate?.assessment?.assessedAt,
      );
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 240_000);

  it("does not allow viewers to launch gated evaluations", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    await seedEchoInputAgent(stack);
    await seedPublishedEvaluationSuite(stack, {
      suiteKey: `m13-7-5-viewer-${Date.now()}`,
      cases: [
        {
          key: "only-case",
          input: { message: "x" },
          expected: { echoed: { message: "x" } },
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
      expect(await page.getByLabel("Enable quality gates").count()).toBe(0);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 120_000);
});
