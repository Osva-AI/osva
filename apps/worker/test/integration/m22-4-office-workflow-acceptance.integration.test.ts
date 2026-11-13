import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GoalId, WorkspaceId } from "@osva-ai/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresOfficeCollaborationRepository,
  PostgresWorkflowRunRepository,
  type Database,
} from "@osva/db";
import { inboxItemIdForApproval } from "@osva/domain";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

import { createWebProcess } from "../../../web/src/process.js";
import { createWorkflowOrchestratorProcess } from "../../../workflow-orchestrator/src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import { createWorkerProcess } from "../../src/process.js";
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

const WORKSPACE_ID = "ws-m22-4-office" as WorkspaceId;
const USER_INBOX = "user-m22-4-inbox" as never;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);
const NOW = new Date("2026-02-01T12:00:00.000Z");

async function prepareEchoAgentFixture(): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-m22-4-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "echo-agent.ts"),
    path.join(trustedRuntimeRoot, "echo-agent.ts"),
  );
  return trustedRuntimeRoot;
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("M22.4D office workflow assignment acceptance", () => {
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
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("runs Mission-linked workflow assignment through approval to completion", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
    );
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let orchestrator:
      ReturnType<typeof createWorkflowOrchestratorProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;

      const goal = await fetchJson(`${origin}/v1/office/goals`, {
        method: "POST",
        body: { key: "mission-m224", title: "Launch review" },
      });
      expect(goal.status).toBe(201);
      const goalId = (goal.body as { id: GoalId }).id;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: { key: "echo-m224", name: "Echo" },
      });
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "echo-m224",
              name: "Echo",
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
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const workerRes = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: { key: "operator", name: "Operator", agentId },
      });
      expect(workerRes.status).toBe(201);
      const officeWorkerId = (workerRes.body as { id: string }).id;

      const workflow = await fetchJson(`${origin}/v1/workflows`, {
        method: "POST",
        body: { key: "m224-approval", name: "M22.4 approval path" },
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
                  title: "Human review",
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

      const beforeRuns = await fetchJson(`${origin}/v1/workflow-runs?limit=1`);
      expect(beforeRuns.status).toBe(200);
      expect(
        ((beforeRuns.body as { items: unknown[] }).items ?? []).length,
      ).toBe(0);
      expect(await queue.countActiveJobs()).toBe(0);

      const assignment = await fetchJson(`${origin}/v1/office/assignments`, {
        method: "POST",
        body: {
          goalId,
          officeWorkerId,
          title: "Review launch",
          targetType: "WORKFLOW_VERSION",
          targetVersionId: workflowVersionId,
          input: { topic: "m22.4 acceptance" },
        },
      });
      expect(assignment.status).toBe(201);
      const assignmentId = (assignment.body as { id: string }).id;
      expect((assignment.body as { status: string }).status).toBe("PENDING");
      expect(
        (assignment.body as { workflowRunId?: string }).workflowRunId,
      ).toBeUndefined();
      expect(await queue.countActiveJobs()).toBe(0);

      const launch = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}/launch`,
        { method: "POST" },
      );
      expect(launch.status).toBe(200);
      const workflowRunId = (launch.body as { workflowRunId: string })
        .workflowRunId;
      expect(workflowRunId).toBeTruthy();

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
          workflowRunId as never,
        );
        return view?.status === "WAITING";
      });

      const waiting = await fetchJson(
        `${origin}/v1/workflow-runs/${workflowRunId}`,
      );
      const waitingBody = waiting.body as {
        status: string;
        approvalRequests: ReadonlyArray<{
          id: string;
          status: string;
        }>;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          childRunId?: string;
        }>;
      };
      expect(waitingBody.status).toBe("WAITING");
      expect(waitingBody.approvalRequests[0]?.status).toBe("PENDING");
      const byKey = Object.fromEntries(
        waitingBody.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(byKey.a?.status).toBe("SUCCEEDED");
      expect(byKey.a?.childRunId).toBeTruthy();
      expect(byKey.review?.status).toBe("WAITING");
      expect(byKey.b).toBeUndefined();

      const collaboration = new PostgresOfficeCollaborationRepository(database);
      const inbox = await collaboration.listInboxItems({
        workspaceId: WORKSPACE_ID,
        userId: USER_INBOX,
        limit: 50,
      });
      const approvalId = waitingBody.approvalRequests[0]!.id;
      const approvalInboxItem = inbox.items.find(
        (item) => item.id === inboxItemIdForApproval(approvalId as never),
      );
      expect(approvalInboxItem?.assignmentId).toBe(assignmentId);

      const decision = await fetchJson(
        `${origin}/v1/approval-requests/${approvalId}/decision`,
        {
          method: "POST",
          body: { decision: "APPROVED", comment: "Proceed" },
        },
      );
      expect(decision.status).toBe(200);

      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          workflowRunId as never,
        );
        return view?.status === "SUCCEEDED";
      });

      const terminalWorkflow = await fetchJson(
        `${origin}/v1/workflow-runs/${workflowRunId}`,
      );
      const terminalBody = terminalWorkflow.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          childRunId?: string;
        }>;
      };
      expect(terminalBody.status).toBe("SUCCEEDED");
      const doneByKey = Object.fromEntries(
        terminalBody.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(doneByKey.b?.status).toBe("SUCCEEDED");
      expect(doneByKey.b?.childRunId).toBeTruthy();

      const assignmentDetail = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}`,
      );
      expect((assignmentDetail.body as { status: string }).status).toBe(
        "COMPLETED",
      );

      const missionTasks = await fetchJson(`${origin}/v1/office/assignments`);
      const missionItems = (
        missionTasks.body as { items: { id: string; status: string }[] }
      ).items;
      expect(
        missionItems.find((item) => item.id === assignmentId)?.status,
      ).toBe("COMPLETED");
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
  }, 180_000);

  it("records approval rejection without launching the successor agent", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
    );
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let orchestrator:
      ReturnType<typeof createWorkflowOrchestratorProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: { key: "echo-reject", name: "Echo" },
      });
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "echo-reject",
              name: "Echo",
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
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const workerRes = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: { key: "reviewer", name: "Reviewer", agentId },
      });
      const officeWorkerId = (workerRes.body as { id: string }).id;

      const workflow = await fetchJson(`${origin}/v1/workflows`, {
        method: "POST",
        body: { key: "m224-reject", name: "Reject path" },
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
                { key: "review", type: "APPROVAL", title: "Reject gate" },
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

      const assignment = await fetchJson(`${origin}/v1/office/assignments`, {
        method: "POST",
        body: {
          officeWorkerId,
          title: "Reject scenario",
          targetType: "WORKFLOW_VERSION",
          targetVersionId: workflowVersionId,
          input: { topic: "reject" },
        },
      });
      const assignmentId = (assignment.body as { id: string }).id;
      const launch = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}/launch`,
        { method: "POST" },
      );
      const workflowRunId = (launch.body as { workflowRunId: string })
        .workflowRunId;

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
          workflowRunId as never,
        );
        return view?.status === "WAITING";
      });

      const waiting = await fetchJson(
        `${origin}/v1/workflow-runs/${workflowRunId}`,
      );
      const approvalId = (
        waiting.body as {
          approvalRequests: ReadonlyArray<{ id: string }>;
        }
      ).approvalRequests[0]!.id;

      await fetchJson(`${origin}/v1/approval-requests/${approvalId}/decision`, {
        method: "POST",
        body: { decision: "REJECTED", comment: "No" },
      });

      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          workflowRunId as never,
        );
        return view?.status === "FAILED";
      });

      const failed = await fetchJson(
        `${origin}/v1/workflow-runs/${workflowRunId}`,
      );
      const failedBody = failed.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
        }>;
        approvalRequests: ReadonlyArray<{ status: string }>;
      };
      expect(failedBody.status).toBe("FAILED");
      expect(failedBody.approvalRequests[0]?.status).toBe("REJECTED");
      expect(
        failedBody.nodeRuns.some((node) => node.workflowNodeKey === "b"),
      ).toBe(false);

      const assignmentDetail = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}`,
      );
      expect((assignmentDetail.body as { status: string }).status).toBe(
        "FAILED",
      );

      const collaboration = new PostgresOfficeCollaborationRepository(database);
      const inbox = await collaboration.listInboxItems({
        workspaceId: WORKSPACE_ID,
        userId: USER_INBOX,
        limit: 50,
      });
      expect(
        inbox.items.some(
          (item) => item.id === inboxItemIdForApproval(approvalId as never),
        ),
      ).toBe(false);
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
  }, 180_000);
});
