import type {
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  WorkflowDefinitionV3,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryApprovalRequestRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Workflow, WorkflowRun, WorkflowVersion } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ReconcileWorkflowRun } from "../src/reconcile-workflow-run.js";
import {
  LATER,
  agentVersionId,
  seedAgentGraph,
  workspaceId,
  wrapRunRepository,
} from "./fixtures.js";

describe("ReconcileWorkflowRun executable definitions", () => {
  it("reconciles a V3 WorkflowRun without rejecting the schema version", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = wrapRunRepository(new MemoryRunRepository(), {});
    const workflows = new MemoryWorkflowRepository();
    const workflowRuns = new MemoryWorkflowRunRepository();
    const workflowWaits = new MemoryWorkflowWaitRepository();
    const approvalRequests = new MemoryApprovalRequestRepository();
    const queue = new MemoryJobQueue();

    await seedAgentGraph(workspaces, agents);

    const workflow = Workflow.create({
      id: "wf-1" as WorkflowId,
      workspaceId,
      key: "v3-run",
      name: "V3 Run",
      createdAt: LATER,
      updatedAt: LATER,
    });
    await workflows.saveWorkflow(workflow);

    const v3Definition: WorkflowDefinitionV3 = {
      schemaVersion: "3",
      nodes: [{ key: "step", type: "AGENT", agentVersionId }],
      edges: [],
    };

    const version = WorkflowVersion.create({
      id: "wfv-1" as WorkflowVersionId,
      workflowId: workflow.id,
      workspaceId,
      version: 1,
      definition: v3Definition,
      createdAt: LATER,
    });
    await workflows.saveWorkflowVersion(version);

    const workflowRun = WorkflowRun.create({
      id: "wfr-1" as WorkflowRunId,
      workspaceId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      input: {},
      createdAt: LATER,
    });
    await workflowRuns.saveWorkflowRun(workflowRun);

    const reconcile = new ReconcileWorkflowRun({
      workflows,
      workflowRuns,
      workflowWaits,
      approvalRequests,
      agents,
      runs,
      createRun: new CreateRun({ runs, agents, queue }),
      queue,
    });

    await expect(
      reconcile.execute({
        workflowRun,
        now: LATER,
        ids: {
          createRunId: () => "run-1" as RunId,
          createRunAttemptId: () => "attempt-1" as RunAttemptId,
          createWorkflowNodeRunId: () => "node-run-1" as WorkflowNodeRunId,
          createApprovalRequestId: () => "approval-1" as ApprovalRequestId,
        },
      }),
    ).resolves.toBeUndefined();
  });
});
