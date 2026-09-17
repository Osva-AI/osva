import type {
  AgentVersionId,
  WorkflowDefinitionV1,
  WorkflowId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateWorkflowKeyError,
  Workflow,
  WorkflowVersion,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowRepository } from "../src/memory-workflow-repository.js";
import { NOW, workspaceId } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;

function definition(): WorkflowDefinitionV1 {
  return {
    schemaVersion: "1",
    nodes: [
      {
        key: "research",
        type: "AGENT",
        agentVersionId: "agent-version-1" as AgentVersionId,
      },
    ],
    edges: [],
  };
}

describe("MemoryWorkflowRepository", () => {
  it("saves and lists Workflows", async () => {
    const repository = new MemoryWorkflowRepository();
    const workflow = Workflow.create({
      id: workflowId,
      workspaceId,
      key: "research-report",
      name: "Research Report",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await repository.saveWorkflow(workflow);
    await expect(repository.findWorkflowById(workflowId)).resolves.toBe(
      workflow,
    );
    await expect(repository.listWorkflows()).resolves.toEqual([workflow]);
  });

  it("rejects duplicate workspace keys", async () => {
    const repository = new MemoryWorkflowRepository();
    await repository.saveWorkflow(
      Workflow.create({
        id: workflowId,
        workspaceId,
        key: "research-report",
        name: "Research Report",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await expect(
      repository.saveWorkflow(
        Workflow.create({
          id: "workflow-2" as WorkflowId,
          workspaceId,
          key: "research-report",
          name: "Other",
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateWorkflowKeyError);
  });

  it("treats saving the same immutable WorkflowVersion as idempotent", async () => {
    const repository = new MemoryWorkflowRepository();
    const version = WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition: definition(),
      createdAt: NOW,
    });

    await repository.saveWorkflowVersion(version);
    await repository.saveWorkflowVersion(version);
    await expect(
      repository.findWorkflowVersionById(workflowVersionId),
    ).resolves.toBe(version);
  });

  it("rejects replacing an immutable WorkflowVersion", async () => {
    const repository = new MemoryWorkflowRepository();
    await repository.saveWorkflowVersion(
      WorkflowVersion.create({
        id: workflowVersionId,
        workflowId,
        workspaceId,
        version: 1,
        definition: definition(),
        createdAt: NOW,
      }),
    );

    await expect(
      repository.saveWorkflowVersion(
        WorkflowVersion.create({
          id: workflowVersionId,
          workflowId,
          workspaceId,
          version: 2,
          definition: definition(),
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });
});
