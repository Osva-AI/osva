import type {
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import { WorkflowNodeRun, WorkflowRun } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowRunRepository } from "../src/memory-workflow-run-repository.js";
import { NOW, workspaceId } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;
const workflowRunId = "workflow-run-1" as WorkflowRunId;

describe("MemoryWorkflowRunRepository", () => {
  it("does not duplicate WorkflowNodeRuns for the same node key", async () => {
    const repository = new MemoryWorkflowRunRepository();
    const workflowRun = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { topic: "osva" },
      createdAt: NOW,
    });
    await repository.saveWorkflowRun(workflowRun);

    const nodeRun = WorkflowNodeRun.create({
      id: "node-run-1" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "research",
      sequence: 1,
      input: { topic: "osva" },
      createdAt: NOW,
    });
    await repository.saveWorkflowNodeRun(nodeRun);

    await expect(
      repository.saveWorkflowNodeRun(
        WorkflowNodeRun.create({
          id: "node-run-2" as WorkflowNodeRunId,
          workspaceId,
          workflowRunId,
          workflowNodeKey: "research",
          sequence: 2,
          input: { topic: "osva" },
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(/already exists/);

    await expect(
      repository.listWorkflowNodeRuns(workflowRunId),
    ).resolves.toHaveLength(1);
  });
});
