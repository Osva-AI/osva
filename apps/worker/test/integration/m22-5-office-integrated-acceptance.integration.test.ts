import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AssignmentId,
  AssignmentState,
  GoalId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresOfficeCollaborationRepository,
  PostgresWorkflowRunRepository,
  type Database,
} from "@osva/db";
import {
  buildOfficeAssignmentExecutionIndex,
  buildOfficeArtifactActivities,
  buildOfficeActivitiesForAssignments,
  buildWorkflowChildRunToAssignmentsIndex,
  collectWorkflowChildRunBindings,
  inboxItemIdForApproval,
  mergeOfficeActivityEntries,
  resolveOfficeDeliverableMissionAssociation,
  resolveOfficeDeliverableTaskAssociation,
  type OfficeActivityWorkflowSnapshot,
  type OfficeDeliverableAssignmentRecord,
  type OfficeExecutionApprovalRecord,
  type OfficeExecutionAssignmentRecord,
  type OfficeExecutionNodeRunRecord,
  type OfficeExecutionWorkflowRunRecord,
  type OfficeObservabilityAssignmentRecord,
} from "@osva/domain";
import { summarizeTaskExecution } from "@osva/domain/office-observability";
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

const WORKSPACE_ID = "ws-m22-5-office" as WorkspaceId;
const USER_INBOX = "user-m22-5-inbox" as never;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);
const NOW = new Date("2026-03-01T12:00:00.000Z");
const ARTIFACT_PAYLOAD = "m22-5-integrated-deliverable";

async function prepareTrustedRuntimeRoot(
  files: readonly string[],
): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-m22-5-"),
  );
  for (const file of files) {
    await fs.copyFile(
      path.join(FIXTURE_DIR, file),
      path.join(trustedRuntimeRoot, file),
    );
  }
  return trustedRuntimeRoot;
}

async function integrityFor(
  trustedRuntimeRoot: string,
  entrypoint: string,
): Promise<string> {
  return sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, entrypoint)),
  );
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition.");
}

async function registerTrustedAgentVersion(
  origin: string,
  key: string,
  entrypoint: string,
  integrity: string,
) {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key, name: key },
  });
  expect(agent.status).toBe(201);
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key,
        name: key,
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint,
          integrity,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 8_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  expect(version.status).toBe(201);
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function mapAssignmentApi(
  body: Record<string, unknown>,
): OfficeExecutionAssignmentRecord {
  return {
    id: body.id as AssignmentId,
    workspaceId: (body.workspaceId ?? WORKSPACE_ID) as WorkspaceId,
    officeWorkerId: body.officeWorkerId as never,
    title: String(body.title),
    status: body.status as AssignmentState,
    targetType: body.targetType as "AGENT_VERSION" | "WORKFLOW_VERSION",
    targetVersionId: String(body.targetVersionId),
    runId: body.runId as RunId | undefined,
    workflowRunId: body.workflowRunId as WorkflowRunId | undefined,
    goalId: body.goalId as string | undefined,
    createdAt: new Date(String(body.createdAt)),
    startedAt: toDate(body.startedAt),
    completedAt: toDate(body.completedAt),
    cancelledAt: toDate(body.cancelledAt),
  };
}

function mapObservabilityAssignment(
  body: Record<string, unknown>,
): OfficeObservabilityAssignmentRecord {
  return {
    id: body.id as AssignmentId,
    workspaceId: (body.workspaceId ?? WORKSPACE_ID) as WorkspaceId,
    officeWorkerId: body.officeWorkerId as never,
    goalId: body.goalId as GoalId | undefined,
    status: body.status as AssignmentState,
    runId: body.runId as RunId | undefined,
    workflowRunId: body.workflowRunId as WorkflowRunId | undefined,
    startedAt: toDate(body.startedAt),
    completedAt: toDate(body.completedAt),
    cancelledAt: toDate(body.cancelledAt),
  };
}

function mapWorkflowSnapshot(
  workflowRunId: WorkflowRunId,
  body: Record<string, unknown>,
  workflowNodes: OfficeActivityWorkflowSnapshot["workflowNodes"],
): OfficeActivityWorkflowSnapshot {
  const workspaceId = (body.workspaceId ?? WORKSPACE_ID) as WorkspaceId;
  const workflowRun: OfficeExecutionWorkflowRunRecord = {
    id: workflowRunId,
    workspaceId,
    workflowVersionId: String(body.workflowVersionId),
    status: String(body.status),
    createdAt: new Date(String(body.createdAt)),
    startedAt: toDate(body.startedAt),
    completedAt: toDate(body.completedAt),
    updatedAt: new Date(String(body.updatedAt ?? body.createdAt)),
  };
  const nodeRuns = (
    (body.nodeRuns as ReadonlyArray<Record<string, unknown>>) ?? []
  ).map((node): OfficeExecutionNodeRunRecord => ({
    id: node.id as never,
    workspaceId,
    workflowRunId,
    workflowNodeKey: String(node.workflowNodeKey),
    sequence: Number(node.sequence ?? 0),
    status: String(node.status),
    childRunId: node.childRunId as RunId | undefined,
    selectedTargetKey: node.selectedTargetKey as string | undefined,
    startedAt: toDate(node.startedAt),
    completedAt: toDate(node.completedAt),
    createdAt: new Date(String(node.createdAt ?? body.createdAt)),
    updatedAt: new Date(
      String(node.updatedAt ?? node.createdAt ?? body.createdAt),
    ),
  }));
  const approvalRequests = (
    (body.approvalRequests as ReadonlyArray<Record<string, unknown>>) ?? []
  ).map((row): OfficeExecutionApprovalRecord => ({
    id: row.id as never,
    workspaceId,
    workflowRunId,
    workflowNodeRunId: row.workflowNodeRunId as never,
    status: String(row.status),
    decisionComment:
      row.decisionComment === undefined
        ? undefined
        : String(row.decisionComment),
    createdAt: new Date(String(row.createdAt)),
    decidedAt: toDate(row.decidedAt),
  }));
  return { workflowRun, nodeRuns, approvalRequests, workflowNodes };
}

function mapAssignmentRows(
  items: ReadonlyArray<Record<string, unknown>>,
): OfficeDeliverableAssignmentRecord[] {
  return items.map((row) => ({
    id: row.id as AssignmentId,
    goalId: row.goalId as GoalId | undefined,
    officeWorkerId: row.officeWorkerId as never,
    targetType: row.targetType as "AGENT_VERSION" | "WORKFLOW_VERSION",
    runId: row.runId as RunId | undefined,
    workflowRunId: row.workflowRunId as never,
  }));
}

describe("M22.5D office integrated acceptance", () => {
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

  it("completes mission workflow with artifact provenance, activity, and metrics", async () => {
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-m22-5-artifact-store-"),
    );
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot([
      "echo-agent.ts",
      "artifact-echo-agent.ts",
    ]);
    const echoIntegrity = await integrityFor(
      trustedRuntimeRoot,
      "echo-agent.ts",
    );
    const artifactIntegrity = await integrityFor(
      trustedRuntimeRoot,
      "artifact-echo-agent.ts",
    );

    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
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
        body: { key: "mission-m255", title: "Ship deliverable" },
      });
      expect(goal.status).toBe(201);
      const goalId = (goal.body as { id: GoalId }).id;

      const echoAgent = await registerTrustedAgentVersion(
        origin,
        "echo-m255a",
        "echo-agent.ts",
        echoIntegrity,
      );
      const artifactAgent = await registerTrustedAgentVersion(
        origin,
        "artifact-m255b",
        "artifact-echo-agent.ts",
        artifactIntegrity,
      );

      const workerRes = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: {
          key: "operator",
          name: "Operator",
          agentId: echoAgent.agentId,
        },
      });
      expect(workerRes.status).toBe(201);
      const officeWorkerId = (workerRes.body as { id: string }).id;

      const workflow = await fetchJson(`${origin}/v1/workflows`, {
        method: "POST",
        body: { key: "m255-approval", name: "Artifact path" },
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
                {
                  key: "a",
                  type: "AGENT",
                  agentVersionId: echoAgent.agentVersionId,
                },
                { key: "review", type: "APPROVAL", title: "Human review" },
                {
                  key: "b",
                  type: "AGENT",
                  agentVersionId: artifactAgent.agentVersionId,
                },
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
          goalId,
          officeWorkerId,
          title: "Produce deliverable",
          targetType: "WORKFLOW_VERSION",
          targetVersionId: workflowVersionId,
          input: { content: ARTIFACT_PAYLOAD },
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

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
          OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
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
        waiting.body as { approvalRequests: ReadonlyArray<{ id: string }> }
      ).approvalRequests[0]!.id;

      const collaboration = new PostgresOfficeCollaborationRepository(database);
      const inbox = await collaboration.listInboxItems({
        workspaceId: WORKSPACE_ID,
        userId: USER_INBOX,
        limit: 50,
      });
      expect(
        inbox.items.find(
          (item) => item.id === inboxItemIdForApproval(approvalId as never),
        )?.assignmentId,
      ).toBe(assignmentId);

      await fetchJson(`${origin}/v1/approval-requests/${approvalId}/decision`, {
        method: "POST",
        body: { decision: "APPROVED", comment: "Proceed" },
      });

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
        approvalRequests: ReadonlyArray<{
          id: string;
          status: string;
          decision?: string;
        }>;
      };
      expect(terminalBody.status).toBe("SUCCEEDED");
      const nodeB = terminalBody.nodeRuns.find(
        (node) => node.workflowNodeKey === "b",
      );
      expect(nodeB?.childRunId).toBeTruthy();

      const assignmentDetail = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}`,
      );
      expect((assignmentDetail.body as { status: string }).status).toBe(
        "COMPLETED",
      );
      expect((assignmentDetail.body as { goalId?: string }).goalId).toBe(
        goalId,
      );

      const artifactsList = await fetchJson(`${origin}/v1/artifacts?limit=50`);
      expect(artifactsList.status).toBe(200);
      const artifactItems = (
        artifactsList.body as {
          items: ReadonlyArray<{
            id: string;
            name: string;
            createdAt: string;
            producer?: { runId?: string };
          }>;
        }
      ).items;
      const matchedArtifact = artifactItems.find(
        (row) => row.producer?.runId === nodeB?.childRunId,
      );
      expect(matchedArtifact).toBeDefined();
      expect(matchedArtifact?.name).toBe("runtime-artifact.txt");

      const assignmentList = await fetchJson(`${origin}/v1/office/assignments`);
      const deliverableAssignments = mapAssignmentRows(
        (assignmentList.body as { items: Record<string, unknown>[] }).items,
      );
      const index = buildOfficeAssignmentExecutionIndex(deliverableAssignments);
      const childBindings = collectWorkflowChildRunBindings(
        terminalBody.nodeRuns.map((node) => ({
          workflowRunId: workflowRunId as never,
          childRunId: node.childRunId,
        })),
      );
      const childIndex = buildWorkflowChildRunToAssignmentsIndex(
        childBindings,
        index,
      );
      const byId = new Map(
        deliverableAssignments.map((row) => [row.id, row] as const),
      );

      const taskAssociation = resolveOfficeDeliverableTaskAssociation(
        nodeB?.childRunId as RunId,
        index,
        childIndex,
      );
      expect(taskAssociation).toEqual({
        kind: "verified",
        assignmentId,
      });
      const missionAssociation = resolveOfficeDeliverableMissionAssociation(
        taskAssociation,
        byId,
      );
      expect(missionAssociation).toEqual({ kind: "verified", goalId });

      const workflowVersionRes = await fetchJson(
        `${origin}/v1/workflows/${workflowId}/versions/${(workflowVersion.body as { id: string }).id}`,
      );
      const definition = (workflowVersionRes.body as { definition: unknown })
        .definition as {
        nodes: ReadonlyArray<{
          key: string;
          type: string;
          agentVersionId?: string;
        }>;
      };
      const assignmentRecord = mapAssignmentApi(
        assignmentDetail.body as Record<string, unknown>,
      );
      const snapshot = mapWorkflowSnapshot(
        workflowRunId as WorkflowRunId,
        terminalWorkflow.body as Record<string, unknown>,
        definition.nodes,
      );

      const activities = buildOfficeActivitiesForAssignments({
        workspaceId: WORKSPACE_ID,
        assignments: [assignmentRecord],
        workflowSnapshotsByRunId: new Map([
          [workflowRunId as WorkflowRunId, snapshot],
        ]),
        agentVersionsById: new Map(),
        workersByAgentId: new Map(),
      });
      const artifactActivities = buildOfficeArtifactActivities({
        artifacts: [
          {
            id: matchedArtifact!.id,
            name: matchedArtifact!.name,
            createdAt: matchedArtifact!.createdAt,
            producerRunId: nodeB?.childRunId as RunId,
          },
        ],
        assignments: deliverableAssignments,
        workflowChildBindings: childBindings,
      });
      const merged = mergeOfficeActivityEntries([
        activities,
        artifactActivities,
      ]);
      const ids = merged.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(
        merged.some((row) => row.activityType === "APPROVAL_APPROVED"),
      ).toBe(true);
      expect(
        merged.some((row) => row.activityType === "ARTIFACT_CREATED"),
      ).toBe(true);
      expect(
        merged.some(
          (row) =>
            row.activityType === "TASK_COMPLETED" &&
            row.assignmentId === assignmentId,
        ),
      ).toBe(true);

      const metrics = summarizeTaskExecution(
        (
          (assignmentList.body as { items: Record<string, unknown>[] }).items ??
          []
        ).map(mapObservabilityAssignment),
        WORKSPACE_ID,
      );
      expect(metrics.completed).toBe(1);
      expect(metrics.failed).toBe(0);
      expect(metrics.terminalDenominator).toBeGreaterThanOrEqual(1);
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
  }, 240_000);

  it("rejects approval without successor artifact or completion metrics inflation", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot([
      "echo-agent.ts",
    ]);
    const integrity = await integrityFor(trustedRuntimeRoot, "echo-agent.ts");
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

      const echoAgent = await registerTrustedAgentVersion(
        origin,
        "echo-reject",
        "echo-agent.ts",
        integrity,
      );
      const workerRes = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: {
          key: "reviewer",
          name: "Reviewer",
          agentId: echoAgent.agentId,
        },
      });
      const officeWorkerId = (workerRes.body as { id: string }).id;

      const workflow = await fetchJson(`${origin}/v1/workflows`, {
        method: "POST",
        body: { key: "m255-reject", name: "Reject path" },
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
                {
                  key: "a",
                  type: "AGENT",
                  agentVersionId: echoAgent.agentVersionId,
                },
                { key: "review", type: "APPROVAL", title: "Reject gate" },
                {
                  key: "b",
                  type: "AGENT",
                  agentVersionId: echoAgent.agentVersionId,
                },
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
        waiting.body as { approvalRequests: ReadonlyArray<{ id: string }> }
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
        nodeRuns: ReadonlyArray<{ workflowNodeKey: string }>;
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

      const artifactsList = await fetchJson(`${origin}/v1/artifacts?limit=20`);
      expect(
        ((artifactsList.body as { items: unknown[] }).items ?? []).length,
      ).toBe(0);

      const assignmentRecord = mapAssignmentApi(
        assignmentDetail.body as Record<string, unknown>,
      );
      const snapshot = mapWorkflowSnapshot(
        workflowRunId as WorkflowRunId,
        failed.body as Record<string, unknown>,
        [],
      );
      const activities = buildOfficeActivitiesForAssignments({
        workspaceId: WORKSPACE_ID,
        assignments: [assignmentRecord],
        workflowSnapshotsByRunId: new Map([
          [workflowRunId as WorkflowRunId, snapshot],
        ]),
        agentVersionsById: new Map(),
        workersByAgentId: new Map(),
      });
      expect(
        activities.some((row) => row.activityType === "APPROVAL_REJECTED"),
      ).toBe(true);
      expect(
        activities.some((row) => row.activityType === "ARTIFACT_CREATED"),
      ).toBe(false);
      expect(
        activities.some((row) => row.activityType === "TASK_COMPLETED"),
      ).toBe(false);

      const metrics = summarizeTaskExecution(
        [
          mapObservabilityAssignment(
            assignmentDetail.body as Record<string, unknown>,
          ),
        ],
        WORKSPACE_ID,
      );
      expect(metrics.failed).toBe(1);
      expect(metrics.completed).toBe(0);
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
  }, 240_000);

  it("launches direct agent task with artifact and without enqueue on create", async () => {
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-m22-5-agent-artifact-"),
    );
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot([
      "artifact-echo-agent.ts",
    ]);
    const integrity = await integrityFor(
      trustedRuntimeRoot,
      "artifact-echo-agent.ts",
    );
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      { queueFactory: () => queue },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const agent = await registerTrustedAgentVersion(
        origin,
        "artifact-direct",
        "artifact-echo-agent.ts",
        integrity,
      );
      const officeWorker = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: {
          key: "producer",
          name: "Producer",
          agentId: agent.agentId,
        },
      });
      const officeWorkerId = (officeWorker.body as { id: string }).id;

      const assignment = await fetchJson(`${origin}/v1/office/assignments`, {
        method: "POST",
        body: {
          officeWorkerId,
          title: "Direct artifact task",
          targetType: "AGENT_VERSION",
          targetVersionId: agent.agentVersionId,
          input: { content: ARTIFACT_PAYLOAD },
        },
      });
      expect(assignment.status).toBe(201);
      const assignmentId = (assignment.body as { id: string }).id;
      expect((assignment.body as { runId?: string }).runId).toBeUndefined();
      expect(await queue.countActiveJobs()).toBe(0);

      const launched = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}/launch`,
        { method: "POST" },
      );
      expect(launched.status).toBe(200);
      const runId = (launched.body as { runId: string }).runId;

      await waitUntil(async () => {
        const detail = await fetchJson(
          `${origin}/v1/office/assignments/${assignmentId}`,
        );
        return (detail.body as { status: string }).status === "COMPLETED";
      });

      const artifacts = await fetchJson(`${origin}/v1/artifacts?limit=20`);
      const artifact = (
        artifacts.body as {
          items: ReadonlyArray<{ producer?: { runId?: string }; id: string }>;
        }
      ).items.find((row) => row.producer?.runId === runId);
      expect(artifact).toBeDefined();

      const deliverableAssignments = mapAssignmentRows([
        {
          ...(assignment.body as Record<string, unknown>),
          runId,
          status: "COMPLETED",
        },
      ]);
      const index = buildOfficeAssignmentExecutionIndex(deliverableAssignments);
      const association = resolveOfficeDeliverableTaskAssociation(
        runId as RunId,
        index,
        new Map(),
      );
      expect(association).toEqual({
        kind: "verified",
        assignmentId: assignmentId as AssignmentId,
      });
    } finally {
      await worker.stop();
      await queue.shutdown();
      await web.stop();
    }
  }, 180_000);
});
