import type {
  AgentVersionId,
  WorkflowDefinitionV1,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { WorkflowVersion } from "../src/workflow-version.js";
import { NOW } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;
const workspaceId = "ws-1" as WorkspaceId;

function createDefinition(): WorkflowDefinitionV1 {
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

describe("WorkflowVersion immutability", () => {
  it("stores a cloned frozen definition snapshot", () => {
    const definition = {
      schemaVersion: "1" as const,
      nodes: [
        {
          key: "research",
          type: "AGENT" as const,
          agentVersionId: "agent-version-1" as AgentVersionId,
        },
      ],
      edges: [] as Array<{ from: string; to: string }>,
    };
    const version = WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition,
      createdAt: NOW,
    });

    definition.nodes[0]!.key = "mutated";
    definition.edges.push({ from: "a", to: "b" });

    expect(version.definition.nodes[0]?.key).toBe("research");
    expect(version.definition.edges).toEqual([]);
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.definition)).toBe(true);
    expect(Object.isFrozen(version.definition.nodes)).toBe(true);
  });

  it("rejects replacing definition fields after construction", () => {
    const version = WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition: createDefinition(),
      createdAt: NOW,
    });

    expect(() => {
      (version as { version: number }).version = 2;
    }).toThrow(TypeError);
  });
});
