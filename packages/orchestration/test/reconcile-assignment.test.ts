import type { AssignmentId, OfficeWorkerId, RunId } from "@osva-ai/contracts";
import {
  MemoryAgentRepository,
  MemoryOfficeRepository,
  MemoryRunRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  Assignment,
  OfficeWorker,
  Run,
  Workspace,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { ReconcileAssignment } from "../src/reconcile-assignment.js";
import {
  NOW,
  agentId,
  agentVersionId,
  createBindings,
  createManifest,
  workspaceId,
} from "./fixtures.js";

describe("ReconcileAssignment", () => {
  it("reconciles a running assignment from a succeeded run on list", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const office = new MemoryOfficeRepository();
    const runs = new MemoryRunRepository();
    const workflowRuns = new MemoryWorkflowRunRepository();

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

    const run = Run.rehydrate({
      id: "run-1" as RunId,
      workspaceId,
      agentId,
      status: "SUCCEEDED",
      effectiveBindings: createBindings(),
      input: { prompt: "hello" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    await runs.saveRun(run);

    const running = Assignment.rehydrate({
      id: "assignment-1" as AssignmentId,
      workspaceId,
      officeWorkerId: worker.id,
      title: "Task",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: {},
      status: "RUNNING",
      runId: run.id,
      createdAt: NOW,
      startedAt: NOW,
    });
    const completed = Assignment.rehydrate({
      id: "assignment-2" as AssignmentId,
      workspaceId,
      officeWorkerId: worker.id,
      title: "Done",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: {},
      status: "COMPLETED",
      runId: run.id,
      createdAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    });
    await office.saveAssignment(running);
    await office.saveAssignment(completed);

    const reconcileAssignment = new ReconcileAssignment({
      office,
      runs,
      workflowRuns,
    });

    const list = await reconcileAssignment.executeList({
      workspaceId,
      now: NOW,
      assignments: [running, completed],
    });

    expect(list.find((item) => item.id === running.id)?.status).toBe(
      "COMPLETED",
    );
    expect(list.find((item) => item.id === completed.id)?.status).toBe(
      "COMPLETED",
    );
  });

  it("leaves terminal assignments unchanged on list reconcile", async () => {
    const office = new MemoryOfficeRepository();
    const runs = new MemoryRunRepository();
    const workflowRuns = new MemoryWorkflowRunRepository();
    const reconcileAssignment = new ReconcileAssignment({
      office,
      runs,
      workflowRuns,
    });

    const pending = Assignment.create({
      id: "assignment-3" as AssignmentId,
      workspaceId,
      officeWorkerId: "office-worker-1" as OfficeWorkerId,
      title: "Pending",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: {},
      now: NOW,
    });
    await office.saveAssignment(pending);

    const list = await reconcileAssignment.executeList({
      workspaceId,
      now: NOW,
      assignments: [pending],
    });

    expect(list[0]?.status).toBe("PENDING");
  });
});
