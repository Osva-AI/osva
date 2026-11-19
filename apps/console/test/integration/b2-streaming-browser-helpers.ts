import type { Page } from "playwright";

import {
  assertNoSentinelLeak,
  consoleJson,
  HUMAN_PASSWORD,
  OPERATOR_EMAIL,
  type M12_3Stack,
} from "./m12-3-harness.js";
import { waitForOverview } from "./m18-1a-browser-helpers.js";

export async function loginAndSelectWorkspaceA(
  page: Page,
  consoleOrigin: string,
): Promise<void> {
  await page.goto(`${consoleOrigin}/login`);
  await page.fill('input[type="email"]', OPERATOR_EMAIL);
  await page.fill('input[type="password"]', HUMAN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(select-workspace|overview)/, { timeout: 60_000 });

  if (page.url().includes("/select-workspace")) {
    await page
      .locator(".workspace-select-list button")
      .filter({ hasText: "ws-m12-3-a" })
      .click();
    await page.waitForURL(/\/overview/, { timeout: 30_000 });
  }

  await waitForOverview(page);
}

export async function selectWorkspaceB(
  page: Page,
  consoleOrigin: string,
): Promise<void> {
  await page.goto(`${consoleOrigin}/select-workspace`);
  await page
    .locator(".workspace-select-list button")
    .filter({ hasText: "ws-m12-3-b" })
    .click();
  await page.waitForURL(/\/overview/, { timeout: 30_000 });
  await waitForOverview(page);
}

export interface StreamingAgentFixture {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly modelProfileVersionId: string;
}

export async function provisionModelStreamAgent(
  stack: M12_3Stack,
  options: {
    readonly agentKey: string;
    readonly fixtureFilename: string;
  },
): Promise<StreamingAgentFixture> {
  const connection = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/model-provider-connections",
    {
      method: "POST",
      body: {
        key: `${options.agentKey}-conn`,
        name: "Fake OpenAI",
        provider: "OPENAI",
      },
    },
  );
  if (connection.status !== 201) {
    throw new Error(`connection create failed: ${connection.status}`);
  }
  assertNoSentinelLeak(connection.text);
  const connectionId = (connection.body as { id: string }).id;

  const connectionVersion = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
    {
      method: "POST",
      body: {
        endpoint: {
          baseUrl: stack.fakeOpenAI.origin,
          allowPrivateNetworks: true,
        },
        credentialRef: { key: "OPENAI_API_KEY" },
      },
    },
  );
  if (connectionVersion.status !== 201) {
    throw new Error(`connection version failed: ${connectionVersion.status}`);
  }
  const connectionVersionId = (connectionVersion.body as { id: string }).id;

  const profile = await consoleJson(
    stack,
    stack.workspaceA,
    "/api/v1/model-profiles",
    {
      method: "POST",
      body: { key: "primary", name: "Primary" },
    },
  );
  if (profile.status !== 201) {
    throw new Error(`profile create failed: ${profile.status}`);
  }
  const modelProfileId = (profile.body as { id: string }).id;

  const mpv = await consoleJson(
    stack,
    stack.workspaceA,
    `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
    {
      method: "POST",
      body: {
        provider: "OPENAI",
        model: "gpt-b2-stream",
        modelProviderConnectionVersionId: connectionVersionId,
      },
    },
  );
  if (mpv.status !== 201) {
    throw new Error(`profile version failed: ${mpv.status}`);
  }
  const modelProfileVersionId = (mpv.body as { id: string }).id;

  const integrity = await stack.copyAgentFixture(options.fixtureFilename);
  const agent = await consoleJson(stack, stack.workspaceA, "/api/v1/agents", {
    method: "POST",
    body: { key: options.agentKey, name: options.agentKey },
  });
  if (agent.status !== 201) {
    throw new Error(`agent create failed: ${agent.status}`);
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
          key: options.agentKey,
          name: options.agentKey,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: options.fixtureFilename,
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 60_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      },
    },
  );
  if (agentVersion.status !== 201) {
    throw new Error(`agent version failed: ${agentVersion.status}`);
  }

  return {
    agentId,
    agentVersionId: (agentVersion.body as { id: string }).id,
    modelProfileVersionId,
  };
}

export async function launchStreamingRun(
  stack: M12_3Stack,
  fixture: StreamingAgentFixture,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const run = await consoleJson(stack, stack.workspaceA, "/api/v1/runs", {
    method: "POST",
    body: {
      agentId: fixture.agentId,
      agentVersionId: fixture.agentVersionId,
      input: { prompt: "b2-browser-stream" },
    },
  });
  if (run.status !== 201) {
    throw new Error(
      `run create failed: ${run.status} ${run.text.slice(0, 400)}`,
    );
  }
  assertNoSentinelLeak(run.text);
  return {
    runId: (run.body as { run: { id: string } }).run.id,
    runAttemptId: (run.body as { runAttempt: { id: string } }).runAttempt.id,
  };
}
