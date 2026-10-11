import { describe, expect, it } from "vitest";

import {
  computeAutoLayoutByNodeKey,
  definitionToFlow,
} from "../src/client/lib/workflow-definition-graph-adapter";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";

const linearDefinition: WorkflowDefinitionView = {
  schemaVersion: "3",
  nodes: [
    { key: "step-a", type: "AGENT", agentVersionId: "av-1" },
    { key: "step-b", type: "AGENT", agentVersionId: "av-2" },
    { key: "step-c", type: "AGENT", agentVersionId: "av-3" },
  ],
  edges: [
    { from: "step-a", to: "step-b" },
    { from: "step-b", to: "step-c" },
  ],
};

const parallelJoinDefinition: WorkflowDefinitionView = {
  schemaVersion: "3",
  nodes: [
    { key: "fork", type: "PARALLEL" },
    { key: "left", type: "AGENT", agentVersionId: "av-1" },
    { key: "right", type: "AGENT", agentVersionId: "av-2" },
    { key: "join", type: "JOIN" },
  ],
  edges: [
    { from: "fork", to: "left" },
    { from: "fork", to: "right" },
    { from: "left", to: "join" },
    { from: "right", to: "join" },
  ],
};

const branchDefinition: WorkflowDefinitionView = {
  schemaVersion: "3",
  nodes: [
    { key: "start", type: "AGENT", agentVersionId: "av-1" },
    {
      key: "route",
      type: "BRANCH",
      selector: "/status",
      cases: [
        { equals: "ok", to: "ok-path" },
        { equals: "retry", to: "retry-path" },
      ],
      defaultTo: "fallback-path",
    },
    { key: "ok-path", type: "AGENT", agentVersionId: "av-2" },
    { key: "retry-path", type: "AGENT", agentVersionId: "av-3" },
    { key: "fallback-path", type: "AGENT", agentVersionId: "av-1" },
    { key: "done", type: "AGENT", agentVersionId: "av-2" },
  ],
  edges: [
    { from: "start", to: "route" },
    { from: "route", to: "ok-path" },
    { from: "route", to: "retry-path" },
    { from: "route", to: "fallback-path" },
    { from: "ok-path", to: "done" },
    { from: "retry-path", to: "done" },
    { from: "fallback-path", to: "done" },
  ],
};

describe("workflow definition graph adapter", () => {
  it("maps node keys and types to stable React Flow identities", () => {
    const flow = definitionToFlow(linearDefinition);
    expect(flow.nodes.map((node) => node.id)).toEqual([
      "step-a",
      "step-b",
      "step-c",
    ]);
    expect(flow.edges.map((edge) => edge.id)).toEqual([
      "edge:step-a->step-b",
      "edge:step-b->step-c",
    ]);
    expect(flow.nodes[0]?.data.nodeType).toBe("AGENT");
    expect(flow.nodes[0]?.draggable).toBe(false);
    expect(flow.nodes[0]?.connectable).toBe(false);
  });

  it("does not mutate the source definition", () => {
    const snapshot = structuredClone(linearDefinition);
    definitionToFlow(linearDefinition);
    expect(linearDefinition).toEqual(snapshot);
  });

  it("assigns increasing layers for a linear chain", () => {
    const layout = computeAutoLayoutByNodeKey(linearDefinition);
    expect(layout["step-a"]!.x).toBeLessThan(layout["step-b"]!.x);
    expect(layout["step-b"]!.x).toBeLessThan(layout["step-c"]!.x);
    expect(layout["step-a"]!.y).toBe(layout["step-b"]!.y);
    expect(layout["step-b"]!.y).toBe(layout["step-c"]!.y);
  });

  it("layers parallel branches and join for a fork/join DAG", () => {
    const layout = computeAutoLayoutByNodeKey(parallelJoinDefinition);
    expect(layout["fork"]!.x).toBeLessThan(layout["left"]!.x);
    expect(layout["fork"]!.x).toBeLessThan(layout["right"]!.x);
    expect(layout["left"]!.x).toBe(layout["right"]!.x);
    expect(layout["left"]!.y).not.toBe(layout["right"]!.y);
    expect(layout["join"]!.x).toBeGreaterThan(layout["left"]!.x);
  });

  it("produces deterministic layout for branch fan-out", () => {
    const first = computeAutoLayoutByNodeKey(branchDefinition);
    const second = computeAutoLayoutByNodeKey(branchDefinition);
    expect(first).toEqual(second);
    expect(first["route"]!.x).toBeLessThan(first["ok-path"]!.x);
    expect(first["done"]!.x).toBeGreaterThan(first["ok-path"]!.x);
  });

  it("produces deterministic flow output for the same definition", () => {
    const first = definitionToFlow(parallelJoinDefinition);
    const second = definitionToFlow(parallelJoinDefinition);
    expect(first).toEqual(second);
  });

  it("keeps authoring errors and execution statuses independent", () => {
    const flow = definitionToFlow(linearDefinition, {
      errorNodeKeys: new Set(["step-a"]),
      executionStatusByNodeKey: { "step-b": "RUNNING", "step-c": "FAILED" },
    });
    const byId = Object.fromEntries(
      flow.nodes.map((node) => [node.id, node.data]),
    );
    expect(byId["step-a"]?.hasError).toBe(true);
    expect(byId["step-a"]?.executionStatus).toBeUndefined();
    expect(byId["step-b"]?.hasError).toBe(false);
    expect(byId["step-b"]?.executionStatus).toBe("RUNNING");
    expect(byId["step-c"]?.hasError).toBe(false);
    expect(byId["step-c"]?.executionStatus).toBe("FAILED");
  });
});
