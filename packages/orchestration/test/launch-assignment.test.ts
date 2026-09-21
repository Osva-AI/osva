import type {
  AssignmentId,
  OfficeWorkerId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
} from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryOfficeRepository,
  MemoryRunRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  Assignment,
  OfficeWorker,
  Workspace,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { LaunchAssignment } from "../src/launch-assignment.js";
import { ReconcileAssignment } from "../src/reconcile-assignment.js";
import { CreateRun } from "../src/create-run.js";
import {
  NOW,
  agentId,
  agentVersionId,
  createManifest,
  workspaceId,
} from "./fixtures.js";

describe("LaunchAssignment", () => {
  it("does not create duplicate runs on repeated launch", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const office = new MemoryOfficeRepository();
    const runs = new MemoryRunRepository();
    const workflows = new MemoryWorkflowRepository();
    const workflowRuns = new MemoryWorkflowRunRepository();
    const queue = new MemoryJobQueue();

    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Workspace", createdAt: NOW }),
    );
    await agents.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "agent",
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

    const worker = OfficeWorker.create({
      id: "office-worker-1" as OfficeWorkerId,
      workspaceId,
      key: "worker",
      name: "Worker",
      agentId,
      now: NOW,
    });
    await office.saveOfficeWorker(worker);

    const assignment = Assignment.create({
      id: "assignment-1" as AssignmentId,
      workspaceId,
      officeWorkerId: worker.id,
      title: "Task",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: { prompt: "hello" },
      now: NOW,
    });
    await office.saveAssignment(assignment);

    const createRun = new CreateRun({ runs, agents, queue });
    const reconcileAssignment = new ReconcileAssignment({
      office,
      runs,
      workflowRuns,
    });
    const launchAssignment = new LaunchAssignment({
      office,
      agents,
      workflows,
      workflowRuns,
      runs,
      createRun,
      reconcileAssignment,
    });

    const first = await launchAssignment.execute({
      assignmentId: assignment.id,
      runId: "run-1" as RunId,
      runAttemptId: "run-attempt-1" as RunAttemptId,
      workflowRunId: "workflow-run-1" as WorkflowRunId,
      now: NOW,
    });

    const second = await launchAssignment.execute({
      assignmentId: assignment.id,
      runId: "run-2" as RunId,
      runAttemptId: "run-attempt-2" as RunAttemptId,
      workflowRunId: "workflow-run-2" as WorkflowRunId,
      now: NOW,
    });

    expect(first.runId).toBeDefined();
    expect(second.runId).toBe(first.runId);

    const listedRuns = await runs.listRuns({ workspaceId, limit: 10 });
    expect(
      listedRuns.runs.filter((run) => run.id === first.runId),
    ).toHaveLength(1);
  });
});
