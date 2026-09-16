import { describe, expect, it } from "vitest";

import { workflowDefinitionSchema } from "../src/schemas/workflow-definition.js";
import { createWorkflowRequestSchema } from "../src/schemas/workflow-registry.js";

describe("Workflow Definition v1 schema", () => {
  it("parses a sequential AGENT graph", () => {
    const parsed = workflowDefinitionSchema.parse({
      schemaVersion: "1",
      nodes: [
        {
          key: "research",
          type: "AGENT",
          agentVersionId: "agent-version-1",
        },
        {
          key: "summarize",
          type: "AGENT",
          agentVersionId: "agent-version-2",
        },
      ],
      edges: [{ from: "research", to: "summarize" }],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toEqual([{ from: "research", to: "summarize" }]);
  });

  it("rejects logical aliases and non-AGENT node types", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: "1",
        nodes: [
          {
            key: "research",
            type: "AGENT",
            agentId: "agent-1",
          },
        ],
        edges: [],
      }).success,
    ).toBe(false);

    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: "1",
        nodes: [
          {
            key: "branch",
            type: "BRANCH",
            agentVersionId: "agent-version-1",
          },
        ],
        edges: [],
      }).success,
    ).toBe(false);
  });
});

describe("Workflow Definition v2 schema", () => {
  it("parses AGENT, BRANCH, PARALLEL, and JOIN nodes", () => {
    const parsed = workflowDefinitionSchema.parse({
      schemaVersion: "2",
      nodes: [
        {
          key: "classifier",
          type: "AGENT",
          agentVersionId: "agent-version-1",
        },
        {
          key: "route",
          type: "BRANCH",
          selector: "/category",
          cases: [{ equals: "sales", to: "sales" }],
          defaultTo: "support",
        },
        {
          key: "sales",
          type: "AGENT",
          agentVersionId: "agent-version-2",
        },
        {
          key: "support",
          type: "AGENT",
          agentVersionId: "agent-version-3",
        },
      ],
      edges: [
        { from: "classifier", to: "route" },
        { from: "route", to: "sales" },
        { from: "route", to: "support" },
      ],
    });

    expect(parsed.schemaVersion).toBe("2");
    expect(parsed.nodes.map((node) => node.type)).toEqual([
      "AGENT",
      "BRANCH",
      "AGENT",
      "AGENT",
    ]);
  });

  it("rejects unknown V2 node types and invalid JSON Pointers", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: "2",
        nodes: [{ key: "tool", type: "TOOL" }],
        edges: [],
      }).success,
    ).toBe(false);

    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: "2",
        nodes: [
          {
            key: "route",
            type: "BRANCH",
            selector: "category",
            cases: [{ equals: "sales", to: "sales" }],
            defaultTo: "support",
          },
        ],
        edges: [],
      }).success,
    ).toBe(false);
  });

  it("does not change V1 rejection of BRANCH nodes", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: "1",
        nodes: [
          {
            key: "route",
            type: "BRANCH",
            selector: "/category",
            cases: [{ equals: "sales", to: "sales" }],
            defaultTo: "support",
          },
        ],
        edges: [],
      }).success,
    ).toBe(false);
  });
});

describe("Workflow registry request schemas", () => {
  it("parses a create Workflow request", () => {
    const parsed = createWorkflowRequestSchema.parse({
      workspaceId: "ws-1",
      key: "research-report",
      name: "Research Report",
    });

    expect(parsed.key).toBe("research-report");
  });

  it("rejects client-supplied Workflow identity", () => {
    const parsed = createWorkflowRequestSchema.safeParse({
      id: "workflow-1",
      workspaceId: "ws-1",
      key: "research-report",
      name: "Research Report",
    });

    expect(parsed.success).toBe(false);
  });
});
