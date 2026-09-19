import type {
  AgentVersionId,
  WorkflowDefinitionV3,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  WorkflowNodeRun,
  buildWorkflowGraph,
  isWorkflowBlockedOnSuspension,
  nodeRunsByKey,
} from "../src/index.js";

const agentA = "agent-version-a" as AgentVersionId;

function parallelWaitAndAgent(): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: [
      { key: "fork", type: "PARALLEL" },
      { key: "delay", type: "WAIT", wait: { kind: "DURATION", durationMs: 1 } },
      { key: "work", type: "AGENT", agentVersionId: agentA },
      { key: "join", type: "JOIN" },
    ],
    edges: [
      { from: "fork", to: "delay" },
      { from: "fork", to: "work" },
      { from: "delay", to: "join" },
      { from: "work", to: "join" },
    ],
  };
}

function nodeRun(
  key: string,
  status: WorkflowNodeRun["status"],
  overrides: Partial<{
    childRunId: WorkflowNodeRun["childRunId"];
  }> = {},
) {
  return WorkflowNodeRun.rehydrate({
    id: `nr-${key}` as WorkflowNodeRunId,
    workspaceId: "ws-1" as WorkspaceId,
    workflowRunId: "wr-1" as WorkflowRunId,
    workflowNodeKey: key,
    sequence: 1,
    status,
    input: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("isWorkflowBlockedOnSuspension", () => {
  it("blocks when only APPROVAL is WAITING", () => {
    const graph = buildWorkflowGraph({
      schemaVersion: "3",
      nodes: [
        { key: "review", type: "APPROVAL", title: "Review" },
        { key: "done", type: "AGENT", agentVersionId: agentA },
      ],
      edges: [{ from: "review", to: "done" }],
    });
    const runs = nodeRunsByKey([nodeRun("review", "WAITING")]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(true);
  });

  it("blocks when only WAIT is WAITING", () => {
    const graph = buildWorkflowGraph({
      schemaVersion: "3",
      nodes: [
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1 },
        },
        { key: "done", type: "AGENT", agentVersionId: agentA },
      ],
      edges: [{ from: "delay", to: "done" }],
    });
    const runs = nodeRunsByKey([nodeRun("delay", "WAITING")]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(true);
  });

  it("does not block when WAIT is WAITING but an AGENT is RUNNING in parallel", () => {
    const graph = buildWorkflowGraph(parallelWaitAndAgent());
    const runs = nodeRunsByKey([
      nodeRun("delay", "WAITING"),
      nodeRun("work", "RUNNING"),
    ]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(false);
  });

  it("does not block when a ready successor can still be materialized", () => {
    const graph = buildWorkflowGraph({
      schemaVersion: "3",
      nodes: [
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1 },
        },
        { key: "done", type: "AGENT", agentVersionId: agentA },
      ],
      edges: [{ from: "delay", to: "done" }],
    });
    const runs = nodeRunsByKey([
      nodeRun("delay", "SUCCEEDED"),
      nodeRun("done", "PENDING"),
    ]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(false);
  });

  it("does not treat a ready unmaterialized WAIT as blocking suspension", () => {
    const graph = buildWorkflowGraph({
      schemaVersion: "3",
      nodes: [
        { key: "step", type: "AGENT", agentVersionId: agentA },
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1 },
        },
      ],
      edges: [{ from: "step", to: "delay" }],
    });
    const runs = nodeRunsByKey([nodeRun("step", "SUCCEEDED")]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(false);
  });

  it("does not count a completed WAIT as active suspension", () => {
    const graph = buildWorkflowGraph({
      schemaVersion: "3",
      nodes: [
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1 },
        },
      ],
      edges: [],
    });
    const runs = nodeRunsByKey([nodeRun("delay", "SUCCEEDED")]);
    expect(isWorkflowBlockedOnSuspension(graph, runs)).toBe(false);
  });
});
