import type { Page } from "playwright";
import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";
import { createDatabase } from "@osva/db";
import { createWorkflowOrchestratorProcess } from "../../../workflow-orchestrator/src/process.js";

import { pollUntil } from "./poll-deadline.js";
import {
  consoleJson,
  CookieJar,
  HUMAN_PASSWORD,
  OPERATOR_EMAIL,
  OWNER_EMAIL,
  type M12_3Stack,
} from "./m12-3-harness.js";

export const VIEWER_EMAIL = "viewer.m13-6@test.local";
export const M13_6_ECHO_AGENT_KEY = "m13-6-echo";

export interface SeededEchoAgent {
  readonly agentId: string;
  readonly agentVersionId: string;
}

export function publishedWorkflowDefinition(
  definition: unknown,
): WorkflowDefinitionV3 {
  const record = definition as WorkflowDefinitionV3;
  return {
    schemaVersion: record.schemaVersion,
    nodes: record.nodes,
    edges: record.edges,
  };
}

export async function seedEchoAgent(
  stack: M12_3Stack,
): Promise<SeededEchoAgent> {
  const integrity = await stack.copyAgentFixture("echo-agent.ts");
  const agent = await consoleJson(stack, stack.workspaceA, "/api/v1/agents", {
    method: "POST",
    body: { key: M13_6_ECHO_AGENT_KEY, name: "M13.6 Echo Agent" },
  });
  if (agent.status !== 201) {
    throw new Error(`Failed to create agent: ${agent.status} ${agent.text}`);
  }
  const agentId = (agent.body as { id: string }).id;
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: M13_6_ECHO_AGENT_KEY,
          name: "M13.6 Echo Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Failed to create agent version: ${version.status} ${version.text}`,
    );
  }
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

export const M13_7_ECHO_INPUT_AGENT_KEY = "m13-7-echo-input";

export async function seedEchoInputAgent(
  stack: M12_3Stack,
): Promise<SeededEchoAgent> {
  const integrity = await stack.copyAgentFixture("echo-input-agent.ts");
  const agent = await consoleJson(stack, stack.workspaceA, "/api/v1/agents", {
    method: "POST",
    body: { key: M13_7_ECHO_INPUT_AGENT_KEY, name: "M13.7 Echo Input Agent" },
  });
  if (agent.status !== 201) {
    throw new Error(`Failed to create agent: ${agent.status} ${agent.text}`);
  }
  const agentId = (agent.body as { id: string }).id;
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: M13_7_ECHO_INPUT_AGENT_KEY,
          name: "M13.7 Echo Input Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-input-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Failed to create agent version: ${version.status} ${version.text}`,
    );
  }
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

export interface SeededEvaluationSuiteVersion {
  readonly evaluationSuiteId: string;
  readonly evaluationSuiteVersionId: string;
}

export async function seedPublishedEvaluationSuite(
  stack: M12_3Stack,
  options: {
    readonly suiteKey: string;
    readonly cases: readonly {
      readonly key: string;
      readonly input: unknown;
      readonly expected: unknown;
    }[];
  },
): Promise<SeededEvaluationSuiteVersion> {
  const suite = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/evaluation-suites",
    {
      method: "POST",
      body: {
        key: options.suiteKey,
        name: "Browser evaluation suite",
      },
    },
  );
  if (suite.status !== 201) {
    throw new Error(`Failed to create suite: ${suite.status} ${suite.text}`);
  }
  const evaluationSuiteId = (suite.body as { id: string }).id;
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId)}/versions`,
    {
      method: "POST",
      body: {
        cases: options.cases.map((evaluationCase) => ({
          key: evaluationCase.key,
          input: evaluationCase.input,
          evaluator: {
            type: "JSON_EXACT_MATCH",
            expected: evaluationCase.expected,
          },
        })),
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Failed to publish suite version: ${version.status} ${version.text}`,
    );
  }
  return {
    evaluationSuiteId,
    evaluationSuiteVersionId: (version.body as { id: string }).id,
  };
}

async function applyCookieJarToPage(
  page: Page,
  consoleOrigin: string,
  jar: CookieJar,
): Promise<void> {
  const header = jar.header();
  if (header === undefined || header.length === 0) {
    throw new Error("Console session cookie missing after login.");
  }
  const url = new URL(consoleOrigin);
  const cookies = header.split("; ").map((pair) => {
    const eq = pair.indexOf("=");
    return {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      domain: url.hostname,
      path: "/",
    };
  });
  await page.context().addCookies(cookies);
}

async function establishConsoleSession(
  stack: M12_3Stack,
  email: string,
): Promise<CookieJar> {
  const jar = new CookieJar();
  const login = await fetch(`${stack.consoleOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.consoleOrigin,
    },
    body: JSON.stringify({ email, password: HUMAN_PASSWORD }),
  });
  jar.absorb(login);
  if (login.status !== 200) {
    throw new Error(
      `Console login failed for ${email}: ${login.status} ${await login.text()}`,
    );
  }
  return jar;
}

export async function loginViewerWorkspaceA(
  page: Page,
  stack: M12_3Stack,
): Promise<void> {
  const jar = await establishConsoleSession(stack, VIEWER_EMAIL);
  await applyCookieJarToPage(page, stack.consoleOrigin, jar);
  await page.goto(`${stack.consoleOrigin}/login`);
  await page.evaluate((workspaceId) => {
    sessionStorage.setItem("osva.console.selectedWorkspaceId", workspaceId);
  }, stack.workspaceA);
  await page.goto(`${stack.consoleOrigin}/workflows`);
  await page.waitForURL(/\/workflows/, { timeout: 60_000 });
}

export async function loginHumanWorkspaceA(
  page: Page,
  stack: M12_3Stack,
  email: string = OPERATOR_EMAIL,
): Promise<void> {
  await page.goto(`${stack.consoleOrigin}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', HUMAN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(select-workspace|overview)/, { timeout: 60_000 });
  if (page.url().includes("/select-workspace")) {
    const workspaceButtons = page.locator(".workspace-select-list button");
    await pollUntil({
      label: `workspace list for ${email}`,
      deadlineMs: 60_000,
      probe: async () => {
        const count = await workspaceButtons.count();
        return { done: count > 0, lastState: count };
      },
    });
    const count = await workspaceButtons.count();
    if (count === 0) {
      throw new Error(`No workspaces available after login for ${email}.`);
    }
    if (count === 1) {
      await workspaceButtons.first().click();
    } else {
      await page
        .getByRole("button", { name: /M12\.3 Workspace A|ws-m12-3-a/i })
        .click();
    }
    await page.waitForURL(/\/overview/, { timeout: 30_000 });
  }
}

export async function provisionViewerInWorkspaceA(
  stack: M12_3Stack,
): Promise<void> {
  const ownerLogin = await fetch(`${stack.webOrigin}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.webOrigin,
    },
    body: JSON.stringify({ email: OWNER_EMAIL, password: HUMAN_PASSWORD }),
  });
  const ownerCookie = ownerLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (ownerLogin.status !== 200 || ownerCookie.length === 0) {
    throw new Error(`Owner login failed: ${ownerLogin.status}`);
  }

  const provision = await fetch(
    `${stack.webOrigin}/v1/auth/workspaces/${stack.workspaceA}/members/users`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: stack.webOrigin,
        "x-osva-workspace-id": stack.workspaceA,
      },
      body: JSON.stringify({
        email: VIEWER_EMAIL,
        displayName: "M13.6 Viewer",
        role: HUMAN_WORKSPACE_ROLES.VIEWER,
      }),
    },
  );
  if (provision.status !== 201) {
    throw new Error(`Viewer provision failed: ${provision.status}`);
  }
  const { setupToken } = (await provision.json()) as { setupToken: string };
  const setup = await fetch(
    `${stack.consoleOrigin}/api/v1/auth/setup/complete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: stack.consoleOrigin,
      },
      body: JSON.stringify({ token: setupToken, password: HUMAN_PASSWORD }),
    },
  );
  if (setup.status !== 200) {
    throw new Error(`Viewer setup failed: ${setup.status}`);
  }

  const jar = await establishConsoleSession(stack, VIEWER_EMAIL);
  const workspaces = await fetch(
    `${stack.consoleOrigin}/api/v1/auth/workspaces`,
    {
      headers: {
        cookie: jar.header() ?? "",
        origin: stack.consoleOrigin,
      },
    },
  );
  if (workspaces.status !== 200) {
    throw new Error(
      `Viewer workspace list failed: ${workspaces.status} ${await workspaces.text()}`,
    );
  }
  const listed = (await workspaces.json()) as {
    workspaces: Array<{ workspaceId: string; role: string }>;
  };
  if (
    !listed.workspaces.some((entry) => entry.workspaceId === stack.workspaceA)
  ) {
    throw new Error(
      `Viewer is not a member of ${stack.workspaceA}: ${JSON.stringify(listed.workspaces)}`,
    );
  }
}

export async function dismissStoredDraftBanner(page: Page): Promise<void> {
  const discard = page.getByRole("button", { name: "Discard saved draft" });
  if (await discard.isVisible().catch(() => false)) {
    await discard.click();
  }
}

export async function waitForWorkflowStudio(page: Page): Promise<void> {
  await page.getByTestId("workflow-studio-v2").waitFor({ timeout: 30_000 });
}

export async function fillWorkflowRegistryInStudio(
  page: Page,
  key: string,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Registry key").fill(key);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Done" }).click();
}

export async function applyWorkflowTemplateInStudio(
  page: Page,
  templateId: "sequential-agents" | "agent-with-approval",
): Promise<void> {
  await page.getByRole("button", { name: "Templates" }).click();
  await page
    .getByRole("heading", { name: "Workflow templates" })
    .waitFor({ timeout: 15_000 });

  const applyByTestId = page.getByTestId(
    `workflow-template-apply-${templateId}`,
  );
  if ((await applyByTestId.count()) > 0) {
    await applyByTestId.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await applyByTestId.click();
  } else {
    const index = templateId === "sequential-agents" ? 0 : 1;
    await page
      .getByRole("button", { name: "Apply template" })
      .nth(index)
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Apply template" })
      .nth(index)
      .click();
  }

  const replaceDraft = page.getByRole("button", { name: "Replace draft" });
  if (await replaceDraft.isVisible().catch(() => false)) {
    await replaceDraft.click();
  }
}

export async function selectBuilderNode(
  page: Page,
  nodeKey: string,
): Promise<void> {
  const fixButton = page.getByTestId(`workflow-validation-fix-${nodeKey}`);
  if (await fixButton.isVisible().catch(() => false)) {
    await fixButton.click();
    return;
  }

  const canvasNode = page.locator(`.react-flow__node[data-id="${nodeKey}"]`);
  if ((await canvasNode.count()) > 0) {
    await canvasNode.first().scrollIntoViewIfNeeded();
    await canvasNode.first().click();
  } else {
    const details = page.locator(".workflow-studio-a11y-steps");
    const summary = details.locator("summary");
    if (await summary.isVisible().catch(() => false)) {
      if ((await details.getAttribute("open")) === null) {
        await summary.click();
      }
    }
    const a11yStep = page.getByTestId(`workflow-a11y-step-${nodeKey}`);
    await a11yStep.scrollIntoViewIfNeeded();
    await a11yStep.click();
  }

  await page
    .locator(
      `#agent-${nodeKey}, #approval-title-${nodeKey}, #wait-duration-${nodeKey}`,
    )
    .first()
    .waitFor({ timeout: 15_000 });
}

export async function bindAgentVersionOnNode(
  page: Page,
  nodeKey: string,
  agentId: string,
  agentVersionId: string,
): Promise<void> {
  await selectBuilderNode(page, nodeKey);
  await page.selectOption(`#agent-${nodeKey}`, agentId);
  await pollUntil({
    label: `agent versions for ${nodeKey}`,
    deadlineMs: 30_000,
    probe: async () => {
      const values = await page
        .locator(`#version-${nodeKey} option`)
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      return {
        done: values.includes(agentVersionId),
        lastState: values,
      };
    },
  });
  await page.selectOption(`#version-${nodeKey}`, agentVersionId);
}

export async function waitForValidationReady(page: Page): Promise<void> {
  await page.getByTestId("workflow-validation-summary").waitFor({
    timeout: 30_000,
  });
  await pollUntil({
    label: "workflow validation ready",
    deadlineMs: 30_000,
    probe: async () => {
      const text =
        (await page.getByTestId("workflow-validation-summary").textContent()) ??
        "";
      return {
        done: /No blocking issues/i.test(text),
        lastState: text,
      };
    },
  });
}

export async function publishFromReview(page: Page, newVersion: boolean) {
  const reviewButtonName = newVersion
    ? "Review and publish new version"
    : "Review and publish";
  const reviewPanel = page.getByTestId("workflow-publish-review");
  if (!(await reviewPanel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: reviewButtonName }).click();
  }
  await reviewPanel.waitFor({
    timeout: 30_000,
  });
  const confirm = reviewPanel.getByRole("button", {
    name: /Confirm publish|Retry publishing/,
  });
  await pollUntil({
    label: "publish review confirm enabled",
    deadlineMs: 30_000,
    probe: async () => {
      const enabled = await confirm.isEnabled().catch(() => false);
      return { done: enabled, lastState: enabled };
    },
  });
  await confirm.click();
  await page.waitForURL(/\/workflows\/[^/]+\/versions\/(?!new)[^/]+$/, {
    timeout: 60_000,
  });
}

export async function fetchWorkflowVersionDefinition(
  stack: M12_3Stack,
  workflowId: string,
  versionId: string,
): Promise<WorkflowDefinitionV3> {
  const loaded = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`,
  );
  if (loaded.status !== 200) {
    throw new Error(
      `Failed to load workflow version: ${loaded.status} ${loaded.text}`,
    );
  }
  return publishedWorkflowDefinition(
    (loaded.body as { definition: unknown }).definition,
  );
}

export async function listWorkflowVersions(
  stack: M12_3Stack,
  workflowId: string,
): Promise<ReadonlyArray<{ id: string; version: number; workflowId: string }>> {
  const listed = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
  );
  if (listed.status !== 200) {
    throw new Error(`Failed to list versions: ${listed.status}`);
  }
  return (
    listed.body as {
      versions: Array<{ id: string; version: number; workflowId: string }>;
    }
  ).versions;
}

export function startWorkflowOrchestrator(options: {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
}) {
  const orchestrator = createWorkflowOrchestratorProcess(
    {
      OSVA_DATABASE_URL: options.databaseUrl,
      OSVA_VALKEY_URL: options.valkeyUrl,
    },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
  );
  return {
    orchestrator,
    start: async () => {
      await orchestrator.start();
    },
    stop: async () => {
      await orchestrator.stop();
    },
  };
}

export async function waitForWorkflowRunStatus(
  stack: M12_3Stack,
  orchestrator: { tickOnce(): Promise<void> },
  workflowRunId: string,
  expected: string,
): Promise<Record<string, unknown>> {
  await pollUntil({
    label: `workflow run ${workflowRunId} → ${expected}`,
    deadlineMs: 180_000,
    probe: async () => {
      await orchestrator.tickOnce();
      const run = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
      );
      const status = (run.body as { status?: string } | null)?.status;
      if (status === "FAILED" && expected !== "FAILED") {
        throw new Error(`Workflow run failed: ${run.text.slice(0, 800)}`);
      }
      return { done: status === expected, lastState: status };
    },
  });
  const finalRun = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
  );
  return finalRun.body as Record<string, unknown>;
}

export async function createSingleAgentWorkflowViaApi(
  stack: M12_3Stack,
  agentVersionId: string,
  key: string,
): Promise<{ workflowId: string; workflowVersionId: string }> {
  const workflow = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/workflows",
    {
      method: "POST",
      body: { key, name: `Workflow ${key}` },
    },
  );
  if (workflow.status !== 201) {
    throw new Error(`Workflow create failed: ${workflow.status}`);
  }
  const workflowId = (workflow.body as { id: string }).id;
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes: [
      { key: "agent", type: "AGENT", agentVersionId: agentVersionId as never },
    ],
    edges: [],
  };
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
    { method: "POST", body: { definition } },
  );
  if (version.status !== 201) {
    throw new Error(`Workflow version failed: ${version.status}`);
  }
  return {
    workflowId,
    workflowVersionId: (version.body as { id: string }).id,
  };
}

export async function createApprovalGateWorkflowViaApi(
  stack: M12_3Stack,
  agentVersionId: string,
): Promise<{ workflowId: string; workflowVersionId: string }> {
  const workflow = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/workflows",
    {
      method: "POST",
      body: { key: "m13-6-approval-gate", name: "M13.6 Approval Gate" },
    },
  );
  const workflowId = (workflow.body as { id: string }).id;
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes: [
      { key: "agent", type: "AGENT", agentVersionId: agentVersionId as never },
      {
        key: "review",
        type: "APPROVAL",
        title: "Approve before continuing",
        description: "Review the agent output.",
      },
      { key: "after", type: "AGENT", agentVersionId: agentVersionId as never },
    ],
    edges: [
      { from: "agent", to: "review" },
      { from: "review", to: "after" },
    ],
  };
  const version = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
    { method: "POST", body: { definition } },
  );
  return {
    workflowId,
    workflowVersionId: (version.body as { id: string }).id,
  };
}
