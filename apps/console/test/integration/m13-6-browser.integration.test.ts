import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { Database } from "@osva/db";

import { ensureConsoleClientDistForBrowserTests } from "./ensure-console-client-dist.js";
import {
  resetM12_3Data,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  consoleJson,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  bindAgentVersionOnNode,
  createApprovalGateWorkflowViaApi,
  createSingleAgentWorkflowViaApi,
  dismissStoredDraftBanner,
  fetchWorkflowVersionDefinition,
  listWorkflowVersions,
  loginHumanWorkspaceA,
  loginViewerWorkspaceA,
  provisionViewerInWorkspaceA,
  publishFromReview,
  publishedWorkflowDefinition,
  seedEchoAgent,
  startWorkflowOrchestrator,
  waitForValidationReady,
  waitForWorkflowRunStatus,
  selectBuilderNode,
} from "./m13-6-browser-helpers.js";

async function launchChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for M13.6 browser acceptance; install root devDependency playwright",
    );
  }
}

describe("M13.6 browser acceptance (no-code workflow builder)", () => {
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

  it("A+B: guided publish V1, publish immutable V2, and verify persisted definitions", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentId, agentVersionId } = await seedEchoAgent(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/workflows/new`);
      await dismissStoredDraftBanner(page);
      await page
        .getByRole("heading", { name: "Create workflow", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page
        .getByRole("button", { name: "Agent with human approval" })
        .click();
      await page.fill("#workflow-key", "m13-6-browser-wf");
      await page.fill("#workflow-name", "M13.6 Browser Workflow");
      await page.getByTestId("workflow-validation-panel").waitFor({
        timeout: 15_000,
      });
      expect(
        await page.getByTestId("workflow-validation-summary").textContent(),
      ).toMatch(/error/i);
      await page.getByRole("button", { name: "Review and publish" }).click();
      await page.getByTestId("workflow-publish-review").waitFor({
        timeout: 15_000,
      });
      expect(
        await page
          .getByTestId("workflow-publish-review-validation")
          .textContent(),
      ).toMatch(/issue/i);
      await page.getByRole("button", { name: "Back to editor" }).click();

      await bindAgentVersionOnNode(
        page,
        "agent-step-1",
        agentId,
        agentVersionId,
      );
      await bindAgentVersionOnNode(
        page,
        "agent-step-3",
        agentId,
        agentVersionId,
      );

      await waitForValidationReady(page);
      await publishFromReview(page, false);
      const v1Url = page.url();
      const v1Match = v1Url.match(/\/workflows\/([^/]+)\/versions\/([^/]+)$/);
      expect(v1Match).not.toBeNull();
      const workflowId = v1Match![1]!;
      const versionV1Id = v1Match![2]!;

      const v1Api = await fetchWorkflowVersionDefinition(
        stack,
        workflowId,
        versionV1Id,
      );
      expect(v1Api.nodes.filter((node) => node.type === "AGENT")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "agent-step-1",
            agentVersionId,
          }),
          expect.objectContaining({
            key: "agent-step-3",
            agentVersionId,
          }),
        ]),
      );
      const v1Approval = v1Api.nodes.find((node) => node.key === "approval-2");
      expect(v1Approval).toMatchObject({
        type: "APPROVAL",
        title: "Review before continuing",
      });

      await page.goto(
        `${stack.consoleOrigin}/workflows/${workflowId}/versions/new`,
      );
      await dismissStoredDraftBanner(page);
      await page
        .getByRole("heading", {
          name: "Publish new workflow version",
          level: 1,
        })
        .waitFor({ timeout: 30_000 });
      await selectBuilderNode(page, "approval-2");
      await page.locator("#approval-title-approval-2").waitFor({
        timeout: 15_000,
      });
      expect(
        await page.locator("#approval-title-approval-2").inputValue(),
      ).toBe("Review before continuing");
      await page.fill(
        "#approval-title-approval-2",
        "Updated approval title for V2",
      );
      await waitForValidationReady(page);
      await publishFromReview(page, true);

      const versions = await listWorkflowVersions(stack, workflowId);
      expect(versions.map((entry) => entry.version).sort()).toEqual([1, 2]);
      expect(new Set(versions.map((entry) => entry.workflowId))).toEqual(
        new Set([workflowId]),
      );

      const versionV2Id = versions.find((entry) => entry.version === 2)!.id;
      const v1Reloaded = await fetchWorkflowVersionDefinition(
        stack,
        workflowId,
        versionV1Id,
      );
      const v2Api = await fetchWorkflowVersionDefinition(
        stack,
        workflowId,
        versionV2Id,
      );
      expect(publishedWorkflowDefinition(v1Reloaded)).toEqual(v1Api);
      expect(
        v2Api.nodes.find((node) => node.key === "approval-2"),
      ).toMatchObject({
        type: "APPROVAL",
        title: "Updated approval title for V2",
      });

      await page.goto(`${stack.consoleOrigin}/workflows/${workflowId}`);
      await page.getByRole("heading", { name: "Versions" }).waitFor({
        timeout: 30_000,
      });
      await page.getByRole("link", { name: versionV1Id }).waitFor({
        timeout: 30_000,
      });
      await page.getByRole("link", { name: versionV2Id }).waitFor({
        timeout: 30_000,
      });
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 420_000);

  it("C: launches a workflow run pinned to a version and reaches a terminal state", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentVersionId } = await seedEchoAgent(stack);
    const { workflowId, workflowVersionId } =
      await createSingleAgentWorkflowViaApi(
        stack,
        agentVersionId,
        "m13-6-run-wf",
      );

    const orchestratorHandle = startWorkflowOrchestrator({
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    await orchestratorHandle.start();

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(
        `${stack.consoleOrigin}/workflows/${workflowId}/versions/${workflowVersionId}`,
      );
      await page
        .getByRole("heading", { name: "Run workflow", level: 2 })
        .waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Start run" }).click();
      await page.getByRole("button", { name: "Confirm start run" }).click();
      await page.waitForURL(/\/workflow-runs\//, { timeout: 60_000 });
      const runUrl = page.url();
      const workflowRunId = runUrl.split("/workflow-runs/")[1] ?? "";

      const persisted = await waitForWorkflowRunStatus(
        stack,
        orchestratorHandle.orchestrator,
        workflowRunId,
        "SUCCEEDED",
      );
      expect(persisted.workflowVersionId).toBe(workflowVersionId);

      await page.reload();
      await pollWorkflowRunUiTerminal(page);
      expect(
        await page.getByText(/Completed|SUCCEEDED/i).count(),
      ).toBeGreaterThan(0);

      const nodeRuns = (persisted.nodeRuns ?? []) as Array<{
        workflowNodeKey: string;
        status: string;
        output?: unknown;
      }>;
      const agentNode = nodeRuns.find(
        (entry) => entry.workflowNodeKey === "agent",
      );
      expect(agentNode?.status).toBe("SUCCEEDED");
      expect(agentNode?.output).toBeDefined();
    } finally {
      await browser.close();
      await orchestratorHandle.stop();
      await stack.close();
    }
  }, 420_000);

  it("D: shows approval wait in Console and resumes after approval decision", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentVersionId } = await seedEchoAgent(stack);
    const { workflowVersionId } = await createApprovalGateWorkflowViaApi(
      stack,
      agentVersionId,
    );

    const created = await consoleJson(
      stack,
      stack.workspaceA,
      "/api/v1/workflow-runs",
      {
        method: "POST",
        body: { workflowVersionId, input: { topic: "approval browser" } },
      },
    );
    expect(created.status).toBe(201);
    const workflowRunId = (created.body as { id: string }).id;

    const orchestratorHandle = startWorkflowOrchestrator({
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    await orchestratorHandle.start();
    await waitForWorkflowRunStatus(
      stack,
      orchestratorHandle.orchestrator,
      workflowRunId,
      "WAITING",
    );

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/workflow-runs/${workflowRunId}`);
      await page.getByText(/Waiting for human approval/i).waitFor({
        timeout: 60_000,
      });
      await page.getByRole("button", { name: "Approve" }).click();

      await waitForWorkflowRunStatus(
        stack,
        orchestratorHandle.orchestrator,
        workflowRunId,
        "SUCCEEDED",
      );
      await page.reload();
      await pollWorkflowRunUiTerminal(page);
    } finally {
      await browser.close();
      await orchestratorHandle.stop();
      await stack.close();
    }
  }, 420_000);

  it("E: hides write and execute workflow actions for VIEWER sessions", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentVersionId } = await seedEchoAgent(stack);
    const { workflowId, workflowVersionId } =
      await createSingleAgentWorkflowViaApi(
        stack,
        agentVersionId,
        "m13-6-viewer-wf",
      );
    await provisionViewerInWorkspaceA(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginViewerWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/workflows`);
      await page
        .getByRole("heading", { name: "Workflows", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(
        await page.getByRole("link", { name: "Create workflow" }).count(),
      ).toBe(0);
      await page.goto(`${stack.consoleOrigin}/workflows/${workflowId}`);
      await page.getByRole("heading", { name: /Workflow/i, level: 1 }).waitFor({
        timeout: 30_000,
      });
      expect(
        await page.getByRole("link", { name: "Publish new version" }).count(),
      ).toBe(0);
      await page.goto(
        `${stack.consoleOrigin}/workflows/${workflowId}/versions/${workflowVersionId}`,
      );
      await page
        .getByRole("heading", { name: "Run workflow", level: 2 })
        .waitFor({ timeout: 30_000 });
      expect(
        (await page
          .getByRole("button", { name: "Start run" })
          .getAttribute("disabled")) !== null,
      ).toBe(true);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 300_000);
});

async function pollWorkflowRunUiTerminal(page: Page): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const text = await page.locator("body").innerText();
    if (/Completed|SUCCEEDED|Failed|FAILED/i.test(text)) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Workflow run UI did not reach a terminal label within 120s. Body: ${(await page.locator("body").innerText()).slice(0, 500)}`,
  );
}
