import type { AgentVersionId, WorkflowDefinitionV1 } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowDefinitionError } from "../src/errors.js";
import {
  assertSequentialWorkflowDefinition,
  orderedSequentialNodeKeys,
} from "../src/workflow-definition.js";

const agentA = "agent-version-a" as AgentVersionId;
const agentB = "agent-version-b" as AgentVersionId;
const agentC = "agent-version-c" as AgentVersionId;

function definition(
  overrides: Partial<WorkflowDefinitionV1> = {},
): WorkflowDefinitionV1 {
  return {
    schemaVersion: "1",
    nodes: [
      { key: "research", type: "AGENT", agentVersionId: agentA },
      { key: "summarize", type: "AGENT", agentVersionId: agentB },
    ],
    edges: [{ from: "research", to: "summarize" }],
    ...overrides,
  };
}

describe("sequential workflow definition validation", () => {
  it("accepts a two-node linear chain", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(definition()),
    ).not.toThrow();
    expect(orderedSequentialNodeKeys(definition())).toEqual([
      "research",
      "summarize",
    ]);
  });

  it("accepts a single-node workflow", () => {
    const single = definition({
      nodes: [{ key: "only", type: "AGENT", agentVersionId: agentA }],
      edges: [],
    });

    expect(() => assertSequentialWorkflowDefinition(single)).not.toThrow();
    expect(orderedSequentialNodeKeys(single)).toEqual(["only"]);
  });

  it("rejects duplicate node keys", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [
            { key: "research", type: "AGENT", agentVersionId: agentA },
            { key: "research", type: "AGENT", agentVersionId: agentB },
          ],
          edges: [],
        }),
      ),
    ).toThrow(/duplicated/);
  });

  it("rejects edges that reference missing nodes", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          edges: [{ from: "research", to: "missing" }],
        }),
      ),
    ).toThrow(/does not exist/);
  });

  it("rejects cycles", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [
            { key: "a", type: "AGENT", agentVersionId: agentA },
            { key: "b", type: "AGENT", agentVersionId: agentB },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        }),
      ),
    ).toThrow(/entry node|cycle/);
  });

  it("rejects a disconnected node", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [
            { key: "research", type: "AGENT", agentVersionId: agentA },
            { key: "summarize", type: "AGENT", agentVersionId: agentB },
            { key: "orphan", type: "AGENT", agentVersionId: agentC },
          ],
          edges: [{ from: "research", to: "summarize" }],
        }),
      ),
    ).toThrow(/not part of the sequential chain|entry node|terminal node/);
  });

  it("rejects branching", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [
            { key: "a", type: "AGENT", agentVersionId: agentA },
            { key: "b", type: "AGENT", agentVersionId: agentB },
            { key: "c", type: "AGENT", agentVersionId: agentC },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "a", to: "c" },
          ],
        }),
      ),
    ).toThrow(/multiple outgoing edges/);
  });

  it("rejects fan-in", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [
            { key: "a", type: "AGENT", agentVersionId: agentA },
            { key: "b", type: "AGENT", agentVersionId: agentB },
            { key: "c", type: "AGENT", agentVersionId: agentC },
          ],
          edges: [
            { from: "a", to: "c" },
            { from: "b", to: "c" },
          ],
        }),
      ),
    ).toThrow(/multiple incoming edges/);
  });

  it("rejects an empty node list", () => {
    expect(() =>
      assertSequentialWorkflowDefinition(
        definition({
          nodes: [],
          edges: [],
        }),
      ),
    ).toThrow(InvalidWorkflowDefinitionError);
  });
});
