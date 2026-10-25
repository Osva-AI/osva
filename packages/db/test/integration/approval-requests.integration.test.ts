import type {
  ApprovalRequestId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva-ai/contracts";
import { APPROVAL_OPERATION_KINDS } from "@osva-ai/contracts";
import {
  assertApprovalDecisionAuthorizesOperation,
  ApprovalRequest,
  LifecycleConflictError,
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresApprovalRequestRepository } from "../../src/repositories/postgres-approval-request-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, LATER, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL approval request repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;
  let approvals: PostgresApprovalRequestRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    workflows = new PostgresWorkflowRepository(database);
    workflowRuns = new PostgresWorkflowRunRepository(database);
    approvals = new PostgresApprovalRequestRepository(database);
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
  });

  it("stores one ApprovalRequest per WorkflowNodeRun with immutable decisions", async () => {
    const seeded = await seedGraph("approval");
    const pending = ApprovalRequest.create({
      id: "approval-1" as ApprovalRequestId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    await expect(
      approvals.saveApprovalRequest(
        ApprovalRequest.create({
          id: "approval-2" as ApprovalRequestId,
          workspaceId: seeded.workspaceId,
          workflowRunId: seeded.workflowRunId,
          workflowNodeRunId: seeded.workflowNodeRunId,
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(/already exists/);

    const approved = await approvals.saveApprovalRequestTransition(
      "PENDING",
      pending.markApproved(LATER, "Looks good."),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.decisionComment).toBe("Looks good.");
    expect(approved.decidedAt).toEqual(LATER);

    await expect(
      approvals.saveApprovalRequestTransition(
        "PENDING",
        pending.markRejected(LATER, "No"),
      ),
    ).rejects.toBeInstanceOf(LifecycleConflictError);

    const reloaded = await approvals.findApprovalRequestByWorkspaceAndId(
      seeded.workspaceId,
      approved.id,
    );
    expect(reloaded?.decisionComment).toBe("Looks good.");
    expect(reloaded?.decidedAt).toEqual(LATER);
  });

  it("makes concurrent conflicting decisions resolve to one winner", async () => {
    const seeded = await seedGraph("race");
    const pending = ApprovalRequest.create({
      id: "approval-race" as ApprovalRequestId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    const results = await Promise.allSettled([
      approvals.saveApprovalRequestTransition(
        "PENDING",
        pending.markApproved(LATER, "Yes"),
      ),
      approvals.saveApprovalRequestTransition(
        "PENDING",
        pending.markRejected(LATER, "No"),
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const stored = await approvals.findApprovalRequestById(pending.id);
    expect(stored?.status === "APPROVED" || stored?.status === "REJECTED").toBe(
      true,
    );
  });

  it("persists operation binding columns from migration 0030", async () => {
    const seeded = await seedGraph("binding");
    const expiresAt = new Date("2026-06-01T00:00:00.000Z");
    const bound = ApprovalRequest.createForWorkflowNodeProgression({
      id: "approval-bound" as ApprovalRequestId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      nodeInput: { campaign: "launch", tier: 1 },
      createdAt: NOW,
      expiresAt,
    });
    await approvals.saveApprovalRequest(bound);

    const loaded = await approvals.findApprovalRequestById(bound.id);
    expect(loaded?.operationKind).toBe(
      APPROVAL_OPERATION_KINDS.WORKFLOW_NODE_PROGRESSION,
    );
    expect(loaded?.operationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(loaded?.expiresAt).toEqual(expiresAt);

    const approved = await approvals.saveApprovalRequestTransition(
      "PENDING",
      bound.markApproved(LATER, "bound ok"),
    );
    expect(approved.operationKind).toBe(loaded?.operationKind);
    expect(approved.operationDigest).toBe(loaded?.operationDigest);
    expect(approved.expiresAt).toEqual(expiresAt);
  });

  it("loads legacy rows with null binding columns", async () => {
    const seeded = await seedGraph("legacy");
    const legacy = ApprovalRequest.create({
      id: "approval-legacy" as ApprovalRequestId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(legacy);

    const loaded = await approvals.findApprovalRequestById(legacy.id);
    expect(loaded?.operationKind).toBeUndefined();
    expect(loaded?.operationDigest).toBeUndefined();
    expect(loaded?.expiresAt).toBeUndefined();
  });

  it("rejects approval when node input no longer matches bound digest", async () => {
    const seeded = await seedGraph("tamper");
    const bound = ApprovalRequest.createForWorkflowNodeProgression({
      id: "approval-tamper" as ApprovalRequestId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      nodeInput: { campaign: "launch" },
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(bound);

    const nodeRun = await workflowRuns.findWorkflowNodeRunById(
      seeded.workflowNodeRunId,
    );
    expect(nodeRun).not.toBeNull();
    const tampered = WorkflowNodeRun.rehydrate({
      id: nodeRun!.id,
      workspaceId: nodeRun!.workspaceId,
      workflowRunId: nodeRun!.workflowRunId,
      workflowNodeKey: nodeRun!.workflowNodeKey,
      sequence: nodeRun!.sequence,
      status: nodeRun!.status,
      input: { campaign: "changed" },
      output: nodeRun!.output,
      childRunId: nodeRun!.childRunId,
      selectedTargetKey: nodeRun!.selectedTargetKey,
      error: nodeRun!.error,
      startedAt: nodeRun!.startedAt,
      completedAt: nodeRun!.completedAt,
      createdAt: nodeRun!.createdAt,
      updatedAt: nodeRun!.updatedAt,
    });

    expect(() =>
      assertApprovalDecisionAuthorizesOperation({
        request: bound,
        nodeRun: tampered,
        decision: "APPROVED",
        now: LATER,
      }),
    ).toThrow();
  });

  it("scopes lookup by workspace", async () => {
    const seeded = await seedGraph("scoped");
    await approvals.saveApprovalRequest(
      ApprovalRequest.create({
        id: "approval-scoped" as ApprovalRequestId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        workflowNodeRunId: seeded.workflowNodeRunId,
        createdAt: NOW,
      }),
    );

    expect(
      await approvals.findApprovalRequestByWorkspaceAndId(
        "workspace_other" as never,
        "approval-scoped" as ApprovalRequestId,
      ),
    ).toBeNull();
  });

  async function seedGraph(label: string): Promise<{
    readonly workspaceId: ReturnType<typeof createIds>["workspaceId"];
    readonly workflowRunId: WorkflowRunId;
    readonly workflowNodeRunId: WorkflowNodeRunId;
  }> {
    const ids = createIds(label);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    const workflowId = `workflow-${label}` as WorkflowId;
    await workflows.saveWorkflow(
      Workflow.create({
        id: workflowId,
        workspaceId: ids.workspaceId,
        key: `wf-${label}`,
        name: "Workflow",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await workflows.saveWorkflowVersion(
      WorkflowVersion.create({
        id: `workflow-version-${label}` as WorkflowVersionId,
        workflowId,
        workspaceId: ids.workspaceId,
        version: 1,
        definition: {
          schemaVersion: "2",
          nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
          edges: [],
        },
        createdAt: NOW,
      }),
    );
    const workflowRunId = `workflow-run-${label}` as WorkflowRunId;
    await workflowRuns.saveWorkflowRun(
      WorkflowRun.create({
        id: workflowRunId,
        workspaceId: ids.workspaceId,
        workflowId,
        workflowVersionId: `workflow-version-${label}` as WorkflowVersionId,
        input: { campaign: "launch" },
        createdAt: NOW,
      }),
    );
    const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: workflowNodeRunId,
        workspaceId: ids.workspaceId,
        workflowRunId,
        workflowNodeKey: "review",
        sequence: 1,
        input: { campaign: "launch" },
        createdAt: NOW,
      }),
    );
    return {
      workspaceId: ids.workspaceId,
      workflowRunId,
      workflowNodeRunId,
    };
  }
});
