import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkflowRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../../worker/src/process.js";
import { createWorkflowOrchestratorProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

const WORKSPACE_ID = "ws-workflow-orchestrator-e2e" as WorkspaceId;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("workflow-orchestrator end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
  });

  it("reconciles a V2 PARALLEL/JOIN WorkflowRun through the orchestrator process", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let orchestrator:
      ReturnType<typeof createWorkflowOrchestratorProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const registered = await createParallelWorkflow(
        origin,
        trustedRuntimeRoot,
      );

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );
      orchestrator = createWorkflowOrchestratorProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );

      await worker.start();

      const workflowRuns = new PostgresWorkflowRunRepository(database);
      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          registered.workflowRunId as never,
        );
        return view?.status === "SUCCEEDED";
      });

      const loaded = await fetchJson(
        `${origin}/v1/workflow-runs/${registered.workflowRunId}`,
      );
      expect(loaded.status).toBe(200);
      const body = loaded.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          childRunId?: string;
        }>;
      };
      expect(body.status).toBe("SUCCEEDED");
      const byKey = Object.fromEntries(
        body.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(byKey.a?.status).toBe("SUCCEEDED");
      expect(byKey.fanout?.status).toBe("SUCCEEDED");
      expect(byKey.b?.status).toBe("SUCCEEDED");
      expect(byKey.c?.status).toBe("SUCCEEDED");
      expect(byKey.join?.status).toBe("SUCCEEDED");
      expect(byKey.d?.status).toBe("SUCCEEDED");
      expect(byKey.a?.childRunId).toBeTruthy();
      expect(byKey.b?.childRunId).toBeTruthy();
      expect(byKey.c?.childRunId).toBeTruthy();
      expect(byKey.d?.childRunId).toBeTruthy();
      expect(byKey.fanout?.childRunId).toBeUndefined();
      expect(byKey.join?.childRunId).toBeUndefined();
      expect(await queue.countActiveJobs()).toBe(0);
    } finally {
      if (orchestrator) {
        await orchestrator.stop();
      }
      if (worker) {
        await worker.stop();
      }
      await queue.shutdown();
      await web.stop();
    }
  });

  it("waits for a durable approval decision before starting the successor agent", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let orchestrator:
      ReturnType<typeof createWorkflowOrchestratorProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const registered = await createApprovalWorkflow(
        origin,
        trustedRuntimeRoot,
      );

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );
      orchestrator = createWorkflowOrchestratorProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );

      await worker.start();

      const workflowRuns = new PostgresWorkflowRunRepository(database);
      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          registered.workflowRunId as never,
        );
        return view?.status === "WAITING_FOR_APPROVAL";
      });

      const waiting = await fetchJson(
        `${origin}/v1/workflow-runs/${registered.workflowRunId}`,
      );
      expect(waiting.status).toBe(200);
      const waitingBody = waiting.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          childRunId?: string;
        }>;
        approvalRequests: ReadonlyArray<{
          id: string;
          status: string;
        }>;
      };
      expect(waitingBody.status).toBe("WAITING_FOR_APPROVAL");
      expect(waitingBody.approvalRequests).toHaveLength(1);
      expect(waitingBody.approvalRequests[0]?.status).toBe("PENDING");
      const byKey = Object.fromEntries(
        waitingBody.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(byKey.a?.status).toBe("SUCCEEDED");
      expect(byKey.a?.childRunId).toBeTruthy();
      expect(byKey.review?.status).toBe("WAITING_FOR_APPROVAL");
      expect(byKey.review?.childRunId).toBeUndefined();
      expect(byKey.b).toBeUndefined();

      const decided = await fetchJson(
        `${origin}/v1/approval-requests/${waitingBody.approvalRequests[0]!.id}/decision`,
        {
          method: "POST",
          body: {
            workspaceId: WORKSPACE_ID,
            decision: "APPROVED",
            comment: "Looks good.",
          },
        },
      );
      expect(decided.status).toBe(200);
      expect((decided.body as { status: string }).status).toBe("APPROVED");

      const stillWaiting = await fetchJson(
        `${origin}/v1/workflow-runs/${registered.workflowRunId}`,
      );
      expect((stillWaiting.body as { status: string }).status).toBe(
        "WAITING_FOR_APPROVAL",
      );

      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          registered.workflowRunId as never,
        );
        return view?.status === "SUCCEEDED";
      });

      const loaded = await fetchJson(
        `${origin}/v1/workflow-runs/${registered.workflowRunId}`,
      );
      const body = loaded.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          childRunId?: string;
        }>;
      };
      expect(body.status).toBe("SUCCEEDED");
      const doneByKey = Object.fromEntries(
        body.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(doneByKey.review?.status).toBe("SUCCEEDED");
      expect(doneByKey.b?.status).toBe("SUCCEEDED");
      expect(doneByKey.b?.childRunId).toBeTruthy();
      expect(await queue.countActiveJobs()).toBe(0);
    } finally {
      if (orchestrator) {
        await orchestrator.stop();
      }
      if (worker) {
        await worker.stop();
      }
      await queue.shutdown();
      await web.stop();
    }
  });
});

async function prepareEchoAgentFixture(): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-workflow-orchestrator-e2e-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "echo-agent.ts"),
    path.join(trustedRuntimeRoot, "echo-agent.ts"),
  );
  return trustedRuntimeRoot;
}

async function createParallelWorkflow(
  origin: string,
  trustedRuntimeRoot: string,
): Promise<{
  readonly workflowRunId: string;
  readonly agentVersionId: string;
}> {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "echo-agent",
      name: "Echo Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;

  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "echo-agent",
        name: "Echo Agent",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
          integrity,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  const agentVersionId = (version.body as { id: string }).id;

  const workflow = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "parallel-join",
      name: "Parallel Join",
    },
  });
  const workflowId = (workflow.body as { id: string }).id;

  const workflowVersion = await fetchJson(
    `${origin}/v1/workflows/${workflowId}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "2",
          nodes: [
            { key: "a", type: "AGENT", agentVersionId },
            { key: "fanout", type: "PARALLEL" },
            { key: "b", type: "AGENT", agentVersionId },
            { key: "c", type: "AGENT", agentVersionId },
            { key: "join", type: "JOIN" },
            { key: "d", type: "AGENT", agentVersionId },
          ],
          edges: [
            { from: "a", to: "fanout" },
            { from: "fanout", to: "b" },
            { from: "fanout", to: "c" },
            { from: "b", to: "join" },
            { from: "c", to: "join" },
            { from: "join", to: "d" },
          ],
        },
      },
    },
  );
  const workflowVersionId = (workflowVersion.body as { id: string }).id;

  const workflowRun = await fetchJson(`${origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      workflowVersionId,
      input: { topic: "orchestrator e2e" },
    },
  });

  return {
    workflowRunId: (workflowRun.body as { id: string }).id,
    agentVersionId,
  };
}

async function createApprovalWorkflow(
  origin: string,
  trustedRuntimeRoot: string,
): Promise<{
  readonly workflowRunId: string;
  readonly agentVersionId: string;
}> {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "echo-agent-approval",
      name: "Echo Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;

  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "echo-agent",
        name: "Echo Agent",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
          integrity,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  const agentVersionId = (version.body as { id: string }).id;

  const workflow = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "approval-gate",
      name: "Approval Gate",
    },
  });
  const workflowId = (workflow.body as { id: string }).id;

  const workflowVersion = await fetchJson(
    `${origin}/v1/workflows/${workflowId}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "2",
          nodes: [
            { key: "a", type: "AGENT", agentVersionId },
            {
              key: "review",
              type: "APPROVAL",
              title: "Approve campaign launch",
            },
            { key: "b", type: "AGENT", agentVersionId },
          ],
          edges: [
            { from: "a", to: "review" },
            { from: "review", to: "b" },
          ],
        },
      },
    },
  );
  const workflowVersionId = (workflowVersion.body as { id: string }).id;

  const workflowRun = await fetchJson(`${origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      workflowVersionId,
      input: { topic: "approval e2e" },
    },
  });

  return {
    workflowRunId: (workflowRun.body as { id: string }).id,
    agentVersionId,
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error("Timed out waiting for workflow orchestrator execution.");
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}
