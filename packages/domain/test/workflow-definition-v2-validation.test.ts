import type { AgentVersionId, WorkflowDefinitionV2 } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowDefinitionError } from "../src/errors.js";
import { assertDagWorkflowDefinition } from "../src/workflow-definition.js";

const agentA = "agent-version-a" as AgentVersionId;
const agentB = "agent-version-b" as AgentVersionId;

function parallelJoin(): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "a", type: "AGENT", agentVersionId: agentA },
      { key: "fanout", type: "PARALLEL" },
      { key: "b", type: "AGENT", agentVersionId: agentA },
      { key: "c", type: "AGENT", agentVersionId: agentB },
      { key: "join", type: "JOIN" },
      { key: "d", type: "AGENT", agentVersionId: agentA },
    ],
    edges: [
      { from: "a", to: "fanout" },
      { from: "fanout", to: "b" },
      { from: "fanout", to: "c" },
      { from: "b", to: "join" },
      { from: "c", to: "join" },
      { from: "join", to: "d" },
    ],
  };
}

function branchGraph(): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "classifier", type: "AGENT", agentVersionId: agentA },
      {
        key: "route",
        type: "BRANCH",
        selector: "/category",
        cases: [
          { equals: "sales", to: "sales" },
          { equals: "support", to: "support" },
        ],
        defaultTo: "support",
      },
      { key: "sales", type: "AGENT", agentVersionId: agentA },
      { key: "support", type: "AGENT", agentVersionId: agentB },
      { key: "join", type: "JOIN" },
    ],
    edges: [
      { from: "classifier", to: "route" },
      { from: "route", to: "sales" },
      { from: "route", to: "support" },
      { from: "sales", to: "join" },
      { from: "support", to: "join" },
    ],
  };
}

describe("V2 DAG workflow definition validation", () => {
  it("accepts a PARALLEL/JOIN graph and a BRANCH graph", () => {
    expect(() => assertDagWorkflowDefinition(parallelJoin())).not.toThrow();
    expect(() => assertDagWorkflowDefinition(branchGraph())).not.toThrow();
  });

  it("rejects unknown node types, duplicate keys, and missing edge nodes", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        ...parallelJoin(),
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "a", type: "PARALLEL" },
        ],
      }),
    ).toThrow(InvalidWorkflowDefinitionError);

    expect(() =>
      assertDagWorkflowDefinition({
        ...parallelJoin(),
        edges: [...parallelJoin().edges, { from: "a", to: "missing" }],
      }),
    ).toThrow(/does not exist/);
  });

  it("rejects cycles, disconnected nodes, and nodes that cannot reach terminal", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "b", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }),
    ).toThrow(/cycle/);

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "orphan", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [],
      }),
    ).toThrow(/exactly one entry|exactly one terminal|reachable/i);
  });

  it("rejects multiple entry or terminal nodes", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "b", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [],
      }),
    ).toThrow(/exactly one entry|exactly one terminal/);
  });

  it("rejects implicit AGENT fan-out and fan-in", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "b", type: "AGENT", agentVersionId: agentA },
          { key: "c", type: "AGENT", agentVersionId: agentB },
          { key: "join", type: "JOIN" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "join" },
          { from: "c", to: "join" },
        ],
      }),
    ).toThrow(/fan-out/);

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "start", type: "AGENT", agentVersionId: agentA },
          { key: "fanout", type: "PARALLEL" },
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "b", type: "AGENT", agentVersionId: agentB },
          { key: "c", type: "AGENT", agentVersionId: agentA },
        ],
        edges: [
          { from: "start", to: "fanout" },
          { from: "fanout", to: "a" },
          { from: "fanout", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "c" },
        ],
      }),
    ).toThrow(/fan-in/);
  });

  it("rejects invalid PARALLEL, JOIN, and BRANCH topology", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "fanout", type: "PARALLEL" },
          { key: "b", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [
          { from: "a", to: "fanout" },
          { from: "fanout", to: "b" },
        ],
      }),
    ).toThrow(/at least two outgoing/);

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "join", type: "JOIN" },
          { key: "b", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [
          { from: "a", to: "join" },
          { from: "join", to: "b" },
        ],
      }),
    ).toThrow(/at least two incoming/);

    expect(() =>
      assertDagWorkflowDefinition({
        ...branchGraph(),
        nodes: branchGraph().nodes.map((node) =>
          node.key === "route"
            ? { ...node, type: "BRANCH" as const, defaultTo: "missing" }
            : node,
        ) as WorkflowDefinitionV2["nodes"],
      }),
    ).toThrow(/defaultTo/);
  });

  it("rejects missing BRANCH default, invalid case targets, and duplicate matches", () => {
    const base = branchGraph();
    const route = base.nodes.find((node) => node.key === "route");
    if (route === undefined || route.type !== "BRANCH") {
      throw new Error("expected branch node");
    }

    expect(() =>
      assertDagWorkflowDefinition({
        ...base,
        nodes: base.nodes.map((node) =>
          node.key === "route" ? { ...route, defaultTo: "" } : node,
        ) as WorkflowDefinitionV2["nodes"],
      }),
    ).toThrow(/defaultTo/);

    expect(() =>
      assertDagWorkflowDefinition({
        ...base,
        nodes: base.nodes.map((node) =>
          node.key === "route"
            ? {
                ...route,
                cases: [{ equals: "sales", to: "missing" }],
              }
            : node,
        ),
      }),
    ).toThrow(/case target/);

    expect(() =>
      assertDagWorkflowDefinition({
        ...base,
        nodes: base.nodes.map((node) =>
          node.key === "route"
            ? {
                ...route,
                cases: [
                  { equals: "sales", to: "sales" },
                  { equals: "sales", to: "support" },
                ],
              }
            : node,
        ),
      }),
    ).toThrow(/duplicate exact-match/);
  });

  it("rejects unknown node types and invalid JSON Pointer selectors", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          {
            key: "wait",
            type: "WAIT",
            agentVersionId: agentA,
          } as unknown as WorkflowDefinitionV2["nodes"][number],
        ],
        edges: [],
      }),
    ).toThrow(/unsupported type/);

    expect(() =>
      assertDagWorkflowDefinition({
        ...branchGraph(),
        nodes: branchGraph().nodes.map((node) =>
          node.key === "route" ? { ...node, selector: "category" } : node,
        ) as WorkflowDefinitionV2["nodes"],
      }),
    ).toThrow(/JSON Pointer/);
  });

  it("accepts APPROVAL as a pass-through gate, including entry and terminal", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          {
            key: "review",
            type: "APPROVAL",
            title: "Approve campaign launch",
            description: "Review before publishing.",
          },
          { key: "b", type: "AGENT", agentVersionId: agentB },
        ],
        edges: [
          { from: "a", to: "review" },
          { from: "review", to: "b" },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          {
            key: "review",
            type: "APPROVAL",
            title: "Start with approval",
          },
          { key: "a", type: "AGENT", agentVersionId: agentA },
        ],
        edges: [{ from: "review", to: "a" }],
      }),
    ).not.toThrow();

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          {
            key: "review",
            type: "APPROVAL",
            title: "Approve only",
          },
        ],
        edges: [],
      }),
    ).not.toThrow();
  });

  it("rejects APPROVAL fan-in, fan-out, and missing titles", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "fanout", type: "PARALLEL" },
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "b", type: "AGENT", agentVersionId: agentB },
          { key: "review", type: "APPROVAL", title: "Approve" },
        ],
        edges: [
          { from: "fanout", to: "a" },
          { from: "fanout", to: "b" },
          { from: "a", to: "review" },
          { from: "b", to: "review" },
        ],
      }),
    ).toThrow(/fan-in/);

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "review", type: "APPROVAL", title: "Approve" },
          { key: "b", type: "AGENT", agentVersionId: agentB },
          { key: "c", type: "AGENT", agentVersionId: agentA },
          { key: "join", type: "JOIN" },
        ],
        edges: [
          { from: "a", to: "review" },
          { from: "review", to: "b" },
          { from: "review", to: "c" },
          { from: "b", to: "join" },
          { from: "c", to: "join" },
        ],
      }),
    ).toThrow(/fan-out/);

    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          {
            key: "review",
            type: "APPROVAL",
            title: "  ",
          } as WorkflowDefinitionV2["nodes"][number],
        ],
        edges: [],
      }),
    ).toThrow(/title/);
  });

  it("rejects a node that cannot reach the terminal", () => {
    expect(() =>
      assertDagWorkflowDefinition({
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "fanout", type: "PARALLEL" },
          { key: "b", type: "AGENT", agentVersionId: agentA },
          { key: "c", type: "AGENT", agentVersionId: agentB },
          { key: "join", type: "JOIN" },
          { key: "d", type: "AGENT", agentVersionId: agentA },
        ],
        edges: [
          { from: "a", to: "fanout" },
          { from: "fanout", to: "b" },
          { from: "fanout", to: "c" },
          { from: "b", to: "join" },
          { from: "join", to: "d" },
        ],
      }),
    ).toThrow(/exactly one terminal|cannot reach the terminal/);
  });
});
