import type { Page } from "playwright";
import type { EvaluationQualityGateMetric } from "@osva-ai/contracts";

import { consoleJson, type M12_3Stack } from "./m12-3-harness.js";
import { pollUntil } from "./poll-deadline.js";
import type { SeededEchoAgent } from "./m13-6-browser-helpers.js";

export const UNPRICED_GEMINI_MODEL_OUTPUT = {
  text: "normalized text from fake gemini",
} as const;

export interface EvaluationRunDetailBody {
  readonly id: string;
  readonly status: string;
  readonly qualityGate?: {
    readonly assessment?: {
      readonly overallVerdict?: string;
      readonly lifecycleVerdict?: string;
      readonly assessedAt?: string;
      readonly ruleResults?: ReadonlyArray<{
        readonly metric: string;
        readonly verdict: string;
        readonly reasonCode?: string;
      }>;
    };
  };
  readonly summary?: {
    readonly unpricedModelCalls?: number;
  };
}

export function evaluationLaunchUrl(
  stack: M12_3Stack,
  params: {
    readonly evaluationSuiteId: string;
    readonly evaluationSuiteVersionId: string;
    readonly agentId: string;
    readonly agentVersionId: string;
  },
): string {
  const query = new URLSearchParams({
    suiteId: params.evaluationSuiteId,
    suiteVersionId: params.evaluationSuiteVersionId,
    agentId: params.agentId,
    agentVersionId: params.agentVersionId,
  });
  return `${stack.consoleOrigin}/testing/runs/new?${query.toString()}`;
}

export function qualityGatePanel(page: Page) {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: "Quality gate" }),
  });
}

export function runStatusPanel(page: Page) {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: "Run status" }),
  });
}

export async function openEvaluationLaunchPage(
  page: Page,
  stack: M12_3Stack,
  params: Parameters<typeof evaluationLaunchUrl>[1],
): Promise<void> {
  await page.goto(evaluationLaunchUrl(stack, params));
  await page
    .getByRole("heading", { name: "Launch batch evaluation", level: 1 })
    .waitFor({ timeout: 30_000 });
}

export async function configureQualityGateRule(
  page: Page,
  options: {
    readonly metric: EvaluationQualityGateMetric;
    readonly thresholdDisplay: string;
  },
): Promise<void> {
  await page.getByRole("checkbox", { name: "Enable quality gates" }).check();
  const metricSelect = page.locator('[id^="gate-metric-"]').first();
  await metricSelect.selectOption(options.metric);
  const threshold = page.locator('[id^="gate-threshold-"]').first();
  await threshold.fill(options.thresholdDisplay);
}

export async function launchEvaluationFromPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Launch evaluation" }).click();
  await page
    .getByRole("heading", { name: "Evaluation run", level: 1 })
    .waitFor({ timeout: 30_000 });
}

export function evaluationRunIdFromPage(page: Page): string {
  const match = page.url().match(/\/testing\/runs\/([^/?#]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`Evaluation run id not found in URL: ${page.url()}`);
  }
  return match[1];
}

export async function waitForEvaluationRunStatus(
  page: Page,
  expected: string,
  deadlineMs = 180_000,
): Promise<void> {
  await pollUntil({
    label: `evaluation run status ${expected}`,
    deadlineMs,
    intervalMs: 1_000,
    probe: async () => {
      const refreshVisible = await page
        .getByRole("button", { name: "Refresh" })
        .isVisible()
        .catch(() => false);
      if (refreshVisible) {
        await page.getByRole("button", { name: "Refresh" }).click();
      }
      const statusPanel = runStatusPanel(page);
      const visible = await statusPanel
        .getByText(expected, { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      return { done: visible, lastState: { expected, visible } };
    },
  });
}

export async function waitForGateVerdictLabel(
  page: Page,
  label: "Pass" | "Fail" | "Indeterminate",
  deadlineMs = 60_000,
): Promise<void> {
  await pollUntil({
    label: `quality gate verdict ${label}`,
    deadlineMs,
    intervalMs: 500,
    probe: async () => {
      const panel = qualityGatePanel(page);
      const visible = await panel
        .getByText(label, { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      return { done: visible, lastState: label };
    },
  });
}

export async function fetchEvaluationRunDetail(
  stack: M12_3Stack,
  evaluationRunId: string,
): Promise<EvaluationRunDetailBody> {
  const detail = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/evaluation-runs/${encodeURIComponent(evaluationRunId)}`,
  );
  if (detail.status !== 200) {
    throw new Error(
      `Failed to load evaluation run ${evaluationRunId}: ${detail.status} ${detail.text.slice(0, 400)}`,
    );
  }
  return detail.body as EvaluationRunDetailBody;
}

export async function seedUnpricedGeminiModelTextAgent(
  stack: M12_3Stack,
  agentKey: string,
): Promise<SeededEchoAgent> {
  const profile = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/model-profiles",
    {
      method: "POST",
      body: { key: `${agentKey}-profile`, name: "Unpriced Gemini profile" },
    },
  );
  if (profile.status !== 201) {
    throw new Error(
      `Failed to create model profile: ${profile.status} ${profile.text}`,
    );
  }
  const modelProfileId = (profile.body as { id: string }).id;
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
    {
      method: "POST",
      body: {
        provider: "GOOGLE_GEMINI",
        model: "gemini-test-snapshot",
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Failed to publish model profile version: ${version.status} ${version.text}`,
    );
  }
  const modelProfileVersionId = (version.body as { id: string }).id;

  const integrity = await stack.copyAgentFixture("model-text-agent.ts");
  const agent = await consoleJson(stack, stack.workspaceA, "/api/v1/agents", {
    method: "POST",
    body: { key: agentKey, name: "Unpriced Gemini model agent" },
  });
  if (agent.status !== 201) {
    throw new Error(`Failed to create agent: ${agent.status} ${agent.text}`);
  }
  const agentId = (agent.body as { id: string }).id;
  const agentVersion = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: agentKey,
          name: "Unpriced Gemini model agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "model-text-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      },
    },
  );
  if (agentVersion.status !== 201) {
    throw new Error(
      `Failed to create agent version: ${agentVersion.status} ${agentVersion.text}`,
    );
  }
  return {
    agentId,
    agentVersionId: (agentVersion.body as { id: string }).id,
  };
}

export function assertGateVerdictMatchesPersistedAssessment(
  uiLabel: "Pass" | "Fail" | "Indeterminate",
  detail: EvaluationRunDetailBody,
): void {
  const overall = detail.qualityGate?.assessment?.overallVerdict;
  const expected =
    uiLabel === "Pass" ? "PASS" : uiLabel === "Fail" ? "FAIL" : "INDETERMINATE";
  if (overall !== expected) {
    throw new Error(
      `Persisted overallVerdict ${String(overall)} did not match UI ${uiLabel} (${expected})`,
    );
  }
}
