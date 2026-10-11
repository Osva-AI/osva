import type {
  AgentVersionId,
  RunId,
  WorkflowDefinitionV3,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  WorkflowNodeRun,
  buildWorkflowGraph,
  inputForNode,
  nodeRunsByKey,
} from "../src/index.js";

const researchVersion = "av-research" as AgentVersionId;
const analysisVersion = "av-analysis" as AgentVersionId;

function researchThenAnalysis(): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: [
      { key: "research", type: "AGENT", agentVersionId: researchVersion },
      { key: "analysis", type: "AGENT", agentVersionId: analysisVersion },
    ],
    edges: [{ from: "research", to: "analysis" }],
  };
}

function nodeRun(
  key: string,
  status: WorkflowNodeRun["status"],
  input: unknown,
  output?: unknown,
  childRunId?: RunId,
) {
  return WorkflowNodeRun.rehydrate({
    id: `nr-${key}` as WorkflowNodeRunId,
    workspaceId: "ws-1" as WorkspaceId,
    workflowRunId: "wr-1" as WorkflowRunId,
    workflowNodeKey: key,
    sequence: key === "research" ? 1 : 2,
    status,
    input,
    output,
    childRunId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("inputForNode sequential AGENT handoff", () => {
  it("gives the WorkflowRun input to the root Research node", () => {
    const graph = buildWorkflowGraph(researchThenAnalysis());
    const workflowInput = {
      schemaVersion: "1",
      request: {
        requestId: "m8-4-handoff-001",
        packageName: "zod",
        useCase: "Runtime validation for public API request bodies",
        constraints: ["Permissive license"],
      },
    };

    expect(inputForNode(graph, "research", new Map(), workflowInput)).toEqual(
      workflowInput,
    );
  });

  it("gives Analysis the persisted Research output, not the WorkflowRun input", () => {
    const graph = buildWorkflowGraph(researchThenAnalysis());
    const workflowInput = {
      schemaVersion: "1",
      request: { packageName: "zod" },
    };
    const researchOutput = {
      schemaVersion: "1",
      request: workflowInput.request,
      evidence: { packageName: "zod", latestVersion: "3.24.1" },
    };
    const nodeRuns = nodeRunsByKey([
      nodeRun(
        "research",
        "SUCCEEDED",
        workflowInput,
        researchOutput,
        "run-research" as RunId,
      ),
    ]);

    expect(inputForNode(graph, "analysis", nodeRuns, workflowInput)).toEqual(
      researchOutput,
    );
  });
});
