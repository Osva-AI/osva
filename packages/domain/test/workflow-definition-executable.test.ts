import type {
  AgentVersionId,
  WorkflowDefinition,
  WorkflowDefinitionV1,
  WorkflowDefinitionV2,
  WorkflowDefinitionV3,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { WorkflowDefinitionNotExecutableError } from "../src/errors.js";
import {
  assertWorkflowDefinitionExecutable,
  buildExecutableWorkflowGraph,
  buildWorkflowGraph,
} from "../src/workflow-definition.js";

const agentVersionId = "agent-version-1" as AgentVersionId;

const v1: WorkflowDefinitionV1 = {
  schemaVersion: "1",
  nodes: [{ key: "step", type: "AGENT", agentVersionId }],
  edges: [],
};

const v2: WorkflowDefinitionV2 = {
  schemaVersion: "2",
  nodes: [{ key: "step", type: "AGENT", agentVersionId }],
  edges: [],
};

const v3: WorkflowDefinitionV3 = {
  schemaVersion: "3",
  nodes: [{ key: "step", type: "AGENT", agentVersionId }],
  edges: [],
};

describe("executable workflow definition boundary", () => {
  it("narrows V1, V2, and V3 for executable graph building", () => {
    expect(() => assertWorkflowDefinitionExecutable(v1)).not.toThrow();
    expect(() => assertWorkflowDefinitionExecutable(v2)).not.toThrow();
    expect(() => assertWorkflowDefinitionExecutable(v3)).not.toThrow();

    const v1Graph = buildExecutableWorkflowGraph(v1);
    expect(v1Graph.definition.schemaVersion).toBe("1");
    expect(v1Graph.nodesByKey.get("step")?.type).toBe("AGENT");

    const v2Graph = buildExecutableWorkflowGraph(v2);
    expect(v2Graph.definition.schemaVersion).toBe("2");

    const v3Graph = buildExecutableWorkflowGraph(v3);
    expect(v3Graph.definition.schemaVersion).toBe("3");
  });

  it("rejects unknown schema versions for executable assertion", () => {
    expect(() =>
      assertWorkflowDefinitionExecutable({
        schemaVersion: "99",
        nodes: [],
        edges: [],
      } as unknown as WorkflowDefinition),
    ).toThrow(WorkflowDefinitionNotExecutableError);
  });

  it("still builds structural graphs for V3", () => {
    const graph = buildWorkflowGraph(v3);
    expect(graph.definition.schemaVersion).toBe("3");
    expect(graph.nodesByKey.get("step")?.type).toBe("AGENT");
  });
});
