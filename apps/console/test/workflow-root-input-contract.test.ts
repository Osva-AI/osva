import { describe, expect, it } from "vitest";

import type { AgentVersionResource } from "../src/client/hooks/use-agents";
import {
  extractAgentVersionInputSchema,
  resolveRootAgentInputContract,
  resolveRootWorkflowNode,
  trySafeExampleFromJsonSchema,
} from "../src/client/lib/workflow-root-input-contract";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";

const researchSchema = {
  type: "object",
  required: ["schemaVersion", "request"],
  properties: {
    schemaVersion: { type: "string", const: "1" },
    request: {
      type: "object",
      required: ["requestId", "packageName", "useCase", "constraints"],
      properties: {
        requestId: { type: "string", minLength: 1 },
        packageName: { type: "string", minLength: 1 },
        useCase: { type: "string", minLength: 1 },
        constraints: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const researchVersion: AgentVersionResource = {
  id: "av-research",
  agentId: "agent-research",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  manifest: { input: { schema: researchSchema } },
};

const catalog = {
  entries: [
    {
      agentId: "agent-research",
      versions: [researchVersion],
    },
  ],
};

function linearAgents(): WorkflowDefinitionView {
  return {
    schemaVersion: "3",
    nodes: [
      { key: "research", type: "AGENT", agentVersionId: "av-research" },
      { key: "analysis", type: "AGENT", agentVersionId: "av-analysis" },
    ],
    edges: [{ from: "research", to: "analysis" }],
  };
}

describe("AgentVersion manifest metadata", () => {
  it("exposes manifest.input.schema from catalog versions", () => {
    expect(extractAgentVersionInputSchema(researchVersion)).toEqual(
      researchSchema,
    );
    expect(researchVersion.manifest?.input?.schema).toBeDefined();
  });
});

describe("resolveRootWorkflowNode", () => {
  it("resolves the single root AGENT binding", () => {
    expect(resolveRootWorkflowNode(linearAgents())).toEqual({
      status: "root_agent",
      node: {
        key: "research",
        type: "AGENT",
        agentVersionId: "av-research",
      },
      agentVersionId: "av-research",
    });
  });

  it("does not invent a contract for a non-AGENT root", () => {
    expect(
      resolveRootWorkflowNode({
        schemaVersion: "3",
        nodes: [
          { key: "review", type: "APPROVAL", title: "Review" },
          { key: "work", type: "AGENT", agentVersionId: "av-research" },
        ],
        edges: [{ from: "review", to: "work" }],
      }),
    ).toEqual({
      status: "non_agent_root",
      node: { key: "review", type: "APPROVAL", title: "Review" },
    });
  });

  it("reports multiple roots when V3 topology is violated", () => {
    const resolved = resolveRootWorkflowNode({
      schemaVersion: "3",
      nodes: [
        { key: "a", type: "AGENT", agentVersionId: "av-1" },
        { key: "b", type: "AGENT", agentVersionId: "av-2" },
      ],
      edges: [],
    });
    expect(resolved.status).toBe("multiple_roots");
    if (resolved.status !== "multiple_roots") {
      throw new Error("expected multiple roots");
    }
    expect(resolved.nodes.map((node) => node.key)).toEqual(["a", "b"]);
  });
});

describe("resolveRootAgentInputContract", () => {
  it("returns the bound AgentVersion input schema", () => {
    expect(resolveRootAgentInputContract(linearAgents(), catalog)).toEqual({
      status: "available",
      nodeKey: "research",
      agentVersionId: "av-research",
      agentId: "agent-research",
      schema: researchSchema,
    });
  });

  it("handles a missing AgentVersion schema without inventing one", () => {
    expect(
      resolveRootAgentInputContract(linearAgents(), {
        entries: [
          {
            agentId: "agent-other",
            versions: [
              {
                id: "av-other",
                agentId: "agent-other",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
                manifest: { input: { schema: {} } },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      status: "schema_unavailable",
      nodeKey: "research",
      agentVersionId: "av-research",
      reason: "version_not_found",
    });
  });

  it("handles a catalog version that omits input.schema", () => {
    expect(
      resolveRootAgentInputContract(linearAgents(), {
        entries: [
          {
            agentId: "agent-research",
            versions: [
              {
                id: "av-research",
                agentId: "agent-research",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      status: "schema_unavailable",
      nodeKey: "research",
      agentVersionId: "av-research",
      reason: "schema_missing",
    });
  });
});

describe("trySafeExampleFromJsonSchema", () => {
  it("does not fabricate required business fields", () => {
    expect(trySafeExampleFromJsonSchema(researchSchema)).toBeUndefined();
  });

  it("returns empty object for empty-object contracts", () => {
    expect(trySafeExampleFromJsonSchema({ type: "object" })).toEqual({});
    expect(trySafeExampleFromJsonSchema({})).toEqual({});
  });

  it("uses const and default values only", () => {
    expect(
      trySafeExampleFromJsonSchema({
        type: "object",
        required: ["schemaVersion", "mode"],
        properties: {
          schemaVersion: { const: "1" },
          mode: { default: "dry-run" },
        },
      }),
    ).toEqual({ schemaVersion: "1", mode: "dry-run" });
  });
});
