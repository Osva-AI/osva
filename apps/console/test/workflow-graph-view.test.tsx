import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let capturedReactFlowProps: Record<string, unknown> | undefined;

vi.mock("@xyflow/react", async () => {
  const actual =
    await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      capturedReactFlowProps = props;
      return <div data-testid="react-flow-mock" />;
    },
  };
});

import { WorkflowGraphView } from "../src/client/components/workflow/workflow-graph-view";

describe("WorkflowGraphView", () => {
  afterEach(() => {
    capturedReactFlowProps = undefined;
    vi.clearAllMocks();
  });

  it("renders read-only React Flow configuration", () => {
    render(
      <WorkflowGraphView
        definition={{
          schemaVersion: "3",
          nodes: [{ key: "a", type: "AGENT", agentVersionId: "av-1" }],
          edges: [],
        }}
      />,
    );

    expect(screen.getByTestId("workflow-graph-view")).toBeTruthy();
    expect(screen.getByTestId("react-flow-mock")).toBeTruthy();
    expect(capturedReactFlowProps?.nodesDraggable).toBe(false);
    expect(capturedReactFlowProps?.nodesConnectable).toBe(false);
    expect(capturedReactFlowProps?.connectOnClick).toBe(false);
    expect(capturedReactFlowProps?.deleteKeyCode).toBe(null);
    expect(capturedReactFlowProps?.elementsSelectable).toBe(false);
  });

  it("allows inspection selection without enabling graph edits", () => {
    const onNodeSelect = vi.fn();
    render(
      <WorkflowGraphView
        definition={{
          schemaVersion: "3",
          nodes: [{ key: "a", type: "AGENT", agentVersionId: "av-1" }],
          edges: [],
        }}
        executionStatusByNodeKey={{ a: "WAITING" }}
        selectedNodeKey="a"
        onNodeSelect={onNodeSelect}
      />,
    );

    expect(capturedReactFlowProps?.nodesDraggable).toBe(false);
    expect(capturedReactFlowProps?.nodesConnectable).toBe(false);
    expect(capturedReactFlowProps?.connectOnClick).toBe(false);
    expect(capturedReactFlowProps?.deleteKeyCode).toBe(null);
    expect(capturedReactFlowProps?.elementsSelectable).toBe(true);
    expect(capturedReactFlowProps?.onNodeClick).toEqual(expect.any(Function));
  });
});
