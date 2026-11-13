import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  AssignmentId,
  OfficeWorkerId,
  UserId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  ApprovalRequest,
  Assignment,
  OfficeWorker,
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
  inboxItemIdForApproval,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresApprovalRequestRepository } from "../../src/repositories/postgres-approval-request-repository.js";
import { PostgresOfficeCollaborationRepository } from "../../src/repositories/postgres-office-collaboration-repository.js";
import { PostgresOfficeRepository } from "../../src/repositories/postgres-office-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW, createManifest } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const USER = "user-inbox" as UserId;
const WS_A = "ws-inbox-a" as WorkspaceId;
const WS_B = "ws-inbox-b" as WorkspaceId;

async function seedApproval(
  database: Database,
  workspaceId: WorkspaceId,
  label: string,
  workflowRunId: WorkflowRunId,
): Promise<ApprovalRequestId> {
  const workflows = new PostgresWorkflowRepository(database);
  const workflowRuns = new PostgresWorkflowRunRepository(database);
  const approvalStore = new PostgresApprovalRequestRepository(database);
  const workflowId = `workflow-${label}` as WorkflowId;
  const workflowVersionId = `workflow-version-${label}` as WorkflowVersionId;
  const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
  const approvalRequestId = `approval-${label}` as ApprovalRequestId;

  await workflows.saveWorkflow(
    Workflow.create({
      id: workflowId,
      workspaceId,
      key: `wf-${label}`,
      name: "Workflow",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
  await workflows.saveWorkflowVersion(
    WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition: {
        schemaVersion: "2",
        nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
        edges: [],
      },
      createdAt: NOW,
    }),
  );
  await workflowRuns.saveWorkflowRun(
    WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: {},
      createdAt: NOW,
    }),
  );
  await workflowRuns.saveWorkflowNodeRun(
    WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: {},
      createdAt: NOW,
    }),
  );
  await approvalStore.saveApprovalRequest(
    ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    }),
  );
  return approvalRequestId;
}

async function seedOfficeWorker(
  database: Database,
  workspaceId: WorkspaceId,
  label: string,
): Promise<{
  readonly officeWorkerId: OfficeWorkerId;
  readonly agentVersionId: AgentVersionId;
}> {
  const agents = new PostgresAgentRepository(database);
  const officeRepo = new PostgresOfficeRepository(database);
  const agentId = `agent-${label}` as AgentId;
  const agentVersionId = `agent-version-${label}` as AgentVersionId;
  const officeWorkerId = `office-worker-${label}` as OfficeWorkerId;

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId,
      key: `agent-${label}`,
      name: "Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    }),
  );
  await officeRepo.saveOfficeWorker(
    OfficeWorker.create({
      id: officeWorkerId,
      workspaceId,
      key: `worker-${label}`,
      name: "Worker",
      agentId,
      now: NOW,
    }),
  );
  return { officeWorkerId, agentVersionId };
}

describe("M22.4D PostgreSQL inbox approval ↔ assignment mapping", () => {
  let context: PostgresTestContext;
  let database: Database;
  let collaboration: PostgresOfficeCollaborationRepository;
  let office: PostgresOfficeRepository;
  let workspaces: PostgresWorkspaceRepository;
  let approvalStore: PostgresApprovalRequestRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    collaboration = new PostgresOfficeCollaborationRepository(database);
    office = new PostgresOfficeRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
    approvalStore = new PostgresApprovalRequestRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({ id: WS_A, name: "A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: WS_B, name: "B", createdAt: NOW }),
    );
  });

  it("Case A: maps assignmentId when one Office assignment owns the workflow run", async () => {
    const workflowRunId = "wfr-unique" as WorkflowRunId;
    const approvalRequestId = await seedApproval(
      database,
      WS_A,
      "unique",
      workflowRunId,
    );
    const { officeWorkerId } = await seedOfficeWorker(database, WS_A, "unique");
    const assignmentId = "asn-unique" as AssignmentId;
    await office.saveAssignment(
      Assignment.create({
        id: assignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Campaign",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-unique",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId, now: NOW }),
    );

    const inbox = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    const approvalItem = inbox.items.find(
      (item) => item.id === inboxItemIdForApproval(approvalRequestId),
    );
    expect(approvalItem).toMatchObject({
      kind: "APPROVAL_PENDING",
      assignmentId,
      workflowRunId,
    });
  });

  it("Case B: omits assignmentId when workflow run is not linked from Office", async () => {
    const workflowRunId = "wfr-standalone" as WorkflowRunId;
    const approvalRequestId = await seedApproval(
      database,
      WS_A,
      "standalone",
      workflowRunId,
    );

    const inbox = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    const approvalItem = inbox.items.find(
      (item) => item.id === inboxItemIdForApproval(approvalRequestId),
    );
    expect(approvalItem?.assignmentId).toBeUndefined();
    expect(approvalItem?.workflowRunId).toBe(workflowRunId);
  });

  it("Case C: omits assignmentId when multiple assignments share the workflow run", async () => {
    const workflowRunId = "wfr-ambiguous" as WorkflowRunId;
    const approvalRequestId = await seedApproval(
      database,
      WS_A,
      "ambiguous",
      workflowRunId,
    );
    const { officeWorkerId } = await seedOfficeWorker(
      database,
      WS_A,
      "ambiguous",
    );
    await office.saveAssignment(
      Assignment.create({
        id: "asn-a-ambiguous" as AssignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "First",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-ambiguous",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId, now: NOW }),
    );
    await office.saveAssignment(
      Assignment.create({
        id: "asn-b-ambiguous" as AssignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Second",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-ambiguous",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId, now: NOW }),
    );

    const inbox = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    const approvalItem = inbox.items.find(
      (item) => item.id === inboxItemIdForApproval(approvalRequestId),
    );
    expect(approvalItem?.assignmentId).toBeUndefined();
  });

  it("Case D: does not leak assignment mapping across workspaces", async () => {
    const workflowRunA = "wfr-ws-a" as WorkflowRunId;
    const workflowRunB = "wfr-ws-b" as WorkflowRunId;
    const approvalA = await seedApproval(database, WS_A, "ws-a", workflowRunA);
    await seedApproval(database, WS_B, "ws-b", workflowRunB);
    const workerA = await seedOfficeWorker(database, WS_A, "ws-a");
    const workerB = await seedOfficeWorker(database, WS_B, "ws-b");
    const assignmentA = "asn-ws-a" as AssignmentId;
    const assignmentB = "asn-ws-b" as AssignmentId;
    await office.saveAssignment(
      Assignment.create({
        id: assignmentA,
        workspaceId: WS_A,
        officeWorkerId: workerA.officeWorkerId,
        title: "A task",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-ws-a",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId: workflowRunA, now: NOW }),
    );
    await office.saveAssignment(
      Assignment.create({
        id: assignmentB,
        workspaceId: WS_B,
        officeWorkerId: workerB.officeWorkerId,
        title: "B task",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-ws-b",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId: workflowRunB, now: NOW }),
    );

    const inboxA = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    const inboxB = await collaboration.listInboxItems({
      workspaceId: WS_B,
      userId: USER,
      limit: 50,
    });
    const itemA = inboxA.items.find(
      (item) => item.id === inboxItemIdForApproval(approvalA),
    );
    expect(itemA?.assignmentId).toBe(assignmentA);
    expect(inboxA.items.some((item) => item.assignmentId === assignmentB)).toBe(
      false,
    );
    expect(inboxB.items.some((item) => item.assignmentId === assignmentA)).toBe(
      false,
    );
  });

  it("Case E: does not duplicate approval inbox rows or break pagination", async () => {
    const runOne = "wfr-page-1" as WorkflowRunId;
    const runTwo = "wfr-page-2" as WorkflowRunId;
    await seedApproval(database, WS_A, "page-1", runOne);
    await seedApproval(database, WS_A, "page-2", runTwo);
    const worker = await seedOfficeWorker(database, WS_A, "page");
    await office.saveAssignment(
      Assignment.create({
        id: "asn-page-1" as AssignmentId,
        workspaceId: WS_A,
        officeWorkerId: worker.officeWorkerId,
        title: "One",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-page-1",
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId: runOne, now: NOW }),
    );

    const pageOne = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 1,
    });
    expect(pageOne.items).toHaveLength(1);
    const ids = new Set(pageOne.items.map((item) => item.id));
    expect(ids.size).toBe(pageOne.items.length);

    const full = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    const approvalIds = full.items
      .filter((item) => item.kind === "APPROVAL_PENDING")
      .map((item) => item.id);
    expect(new Set(approvalIds).size).toBe(approvalIds.length);
    expect(approvalIds).toHaveLength(2);
  });

  it("Case F: drops resolved approvals from the inbox feed", async () => {
    const workflowRunId = "wfr-resolve" as WorkflowRunId;
    const approvalRequestId = await seedApproval(
      database,
      WS_A,
      "resolve",
      workflowRunId,
    );
    const pendingInbox = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    expect(
      pendingInbox.items.some(
        (item) => item.id === inboxItemIdForApproval(approvalRequestId),
      ),
    ).toBe(true);

    const pending =
      await approvalStore.findApprovalRequestById(approvalRequestId);
    if (pending === null) {
      throw new Error("missing approval");
    }
    await approvalStore.saveApprovalRequestTransition(
      "PENDING",
      pending.markApproved(NOW, "ok"),
    );

    const resolvedInbox = await collaboration.listInboxItems({
      workspaceId: WS_A,
      userId: USER,
      limit: 50,
    });
    expect(
      resolvedInbox.items.some(
        (item) => item.id === inboxItemIdForApproval(approvalRequestId),
      ),
    ).toBe(false);
  });
});
