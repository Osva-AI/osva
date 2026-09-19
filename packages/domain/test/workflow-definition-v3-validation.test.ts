import type {
  AgentVersionId,
  WorkflowDefinitionV3,
  WorkflowDefinitionWaitConfigurationV3,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowDefinitionError } from "../src/errors.js";
import {
  assertWorkflowDefinition,
  buildWorkflowGraph,
  listAgentNodes,
} from "../src/workflow-definition.js";

const agentA = "agent-version-a" as AgentVersionId;

function v3AgentThenWait(
  wait: WorkflowDefinitionWaitConfigurationV3,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: [
      { key: "step", type: "AGENT", agentVersionId: agentA },
      { key: "delay", type: "WAIT", wait },
    ],
    edges: [{ from: "step", to: "delay" }],
  };
}

describe("V3 workflow definition validation", () => {
  it("accepts WAIT DURATION, UNTIL, and EVENT variants", () => {
    expect(() =>
      assertWorkflowDefinition(
        v3AgentThenWait({ kind: "DURATION", durationMs: 1_800_000 }),
      ),
    ).not.toThrow();

    expect(() =>
      assertWorkflowDefinition(
        v3AgentThenWait({
          kind: "UNTIL",
          until: "2026-10-01T10:00:00Z",
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertWorkflowDefinition(
        v3AgentThenWait({
          kind: "EVENT",
          source: "payments",
          eventType: "payment.completed",
          correlation: { kind: "LITERAL", value: "order_123" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertWorkflowDefinition(
        v3AgentThenWait({
          kind: "EVENT",
          source: "payments",
          eventType: "payment.completed",
          correlation: { kind: "INPUT_POINTER", pointer: "/orderId" },
          timeoutMs: 86_400_000,
        }),
      ),
    ).not.toThrow();
  });

  it("allows WAIT as entry, intermediate, and terminal nodes", () => {
    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1_000 },
          },
        ],
        edges: [],
      }),
    ).not.toThrow();

    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1_000 },
          },
          { key: "b", type: "AGENT", agentVersionId: agentA },
        ],
        edges: [
          { from: "a", to: "delay" },
          { from: "delay", to: "b" },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          { key: "step", type: "AGENT", agentVersionId: agentA },
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1_000 },
          },
        ],
        edges: [{ from: "step", to: "delay" }],
      }),
    ).not.toThrow();
  });

  it("rejects WAIT fan-out and fan-in", () => {
    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1_000 },
          },
          { key: "b", type: "AGENT", agentVersionId: agentA },
          { key: "c", type: "AGENT", agentVersionId: agentA },
        ],
        edges: [
          { from: "a", to: "delay" },
          { from: "delay", to: "b" },
          { from: "delay", to: "c" },
        ],
      }),
    ).toThrow(InvalidWorkflowDefinitionError);

    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: agentA },
          { key: "fan", type: "PARALLEL" },
          { key: "b", type: "AGENT", agentVersionId: agentA },
          { key: "c", type: "AGENT", agentVersionId: agentA },
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1_000 },
          },
        ],
        edges: [
          { from: "a", to: "fan" },
          { from: "fan", to: "b" },
          { from: "fan", to: "c" },
          { from: "b", to: "delay" },
          { from: "c", to: "delay" },
        ],
      }),
    ).toThrow(InvalidWorkflowDefinitionError);
  });

  it("lists AGENT bindings and builds a graph for valid V3", () => {
    const definition = v3AgentThenWait({
      kind: "DURATION",
      durationMs: 5_000,
    });
    assertWorkflowDefinition(definition);
    expect(listAgentNodes(definition)).toHaveLength(1);
    const graph = buildWorkflowGraph(definition);
    expect(graph.nodesByKey.get("delay")?.type).toBe("WAIT");
  });

  it("rejects invalid WAIT configuration and unknown node types", () => {
    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 0 },
          },
        ],
        edges: [],
      }),
    ).toThrow(InvalidWorkflowDefinitionError);

    expect(() =>
      assertWorkflowDefinition({
        schemaVersion: "3",
        nodes: [{ key: "tool", type: "TOOL" } as never],
        edges: [],
      }),
    ).toThrow(InvalidWorkflowDefinitionError);
  });
});
