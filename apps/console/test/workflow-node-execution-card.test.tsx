import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowNodeExecutionCard } from "../src/client/components/workflow/workflow-node-execution-card";
import type { WorkflowNodeRunResource } from "../src/client/hooks/use-workflow-runs";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";

const parallelDefinition: WorkflowDefinitionView = {
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
    {
      key: "route",
      type: "BRANCH",
      selector: "/status",
      defaultTo: "fallback",
    },
    { key: "ok", type: "AGENT", agentVersionId: "av-1" },
    { key: "fallback", type: "AGENT", agentVersionId: "av-1" },
  ],
  edges: [
    { from: "route", to: "ok" },
    { from: "route", to: "fallback" },
  ],
};

function nodeRun(
  overrides: Partial<WorkflowNodeRunResource> &
    Pick<WorkflowNodeRunResource, "id" | "workflowNodeKey" | "status">,
): WorkflowNodeRunResource {
  return {
    workspaceId: "ws-1",
    workflowRunId: "wr-1",
    sequence: 1,
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(
  nodeKey: string,
  definition: WorkflowDefinitionView,
  options: {
    readonly nodeRun?: WorkflowNodeRunResource;
    readonly relatedNodeRuns?: readonly WorkflowNodeRunResource[];
    readonly nodeRuns?: readonly WorkflowNodeRunResource[];
    readonly canExecute?: boolean;
    readonly approvalRequest?: {
      readonly id: string;
      readonly status: string;
    };
  } = {},
) {
  const node = definition.nodes.find((entry) => entry.key === nodeKey)!;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkflowNodeExecutionCard
          definition={definition}
          node={node}
          nodeRun={options.nodeRun}
          relatedNodeRuns={options.relatedNodeRuns ?? []}
          nodeRuns={options.nodeRuns ?? []}
          approvalRequest={
            options.approvalRequest === undefined
              ? undefined
              : {
                  id: options.approvalRequest.id,
                  workspaceId: "ws-1",
                  workflowRunId: "wr-1",
                  workflowNodeRunId: "wn-approval",
                  status: options.approvalRequest.status,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                }
          }
          workflowRunId="wr-1"
          workflowInput={{}}
          canExecute={options.canExecute ?? true}
          showConnector={false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkflowNodeExecutionCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not treat a missing record as PENDING", () => {
    renderCard("left", parallelDefinition);
    expect(screen.getByText("NO RECORD")).toBeTruthy();
    expect(screen.queryByText("PENDING")).toBeNull();
    expect(
      screen.getByText(/not treated as pending or executed/i),
    ).toBeTruthy();
  });

  it("links AGENT child Runs and withholds RunAttempt invention", () => {
    renderCard("left", parallelDefinition, {
      nodeRun: nodeRun({
        id: "wn-left",
        workflowNodeKey: "left",
        status: "SUCCEEDED",
        childRunId: "run-left",
      }),
    });
    expect(
      screen.getByRole("link", { name: /run-left/ }).getAttribute("href"),
    ).toBe("/runs/run-left");
    expect(screen.getByText(/RunAttempts are listed on that Run/)).toBeTruthy();
    expect(screen.queryByText(/automatic retry/i)).toBeNull();
  });

  it("labels duplicate WorkflowNodeRuns as historical node records", () => {
    const older = nodeRun({
      id: "wn-old",
      workflowNodeKey: "left",
      status: "FAILED",
      sequence: 1,
    });
    const latest = nodeRun({
      id: "wn-new",
      workflowNodeKey: "left",
      status: "SUCCEEDED",
      sequence: 2,
      childRunId: "run-left",
    });
    renderCard("left", parallelDefinition, {
      nodeRun: latest,
      relatedNodeRuns: [older, latest],
    });
    expect(screen.getByText(/historical WorkflowNodeRun records/)).toBeTruthy();
    expect(screen.getByText(/not RunAttempts/)).toBeTruthy();
    expect(screen.getByText(/do not imply automatic retry/)).toBeTruthy();
    expect(screen.queryByText(/earlier attempts/i)).toBeNull();
    expect(screen.getByText(/wn-old · seq 1 · FAILED/)).toBeTruthy();
  });

  it("does not invent a BRANCH decision from topology", () => {
    renderCard("route", branchDefinition, {
      nodeRun: nodeRun({
        id: "wn-route",
        workflowNodeKey: "route",
        status: "SUCCEEDED",
      }),
    });
    expect(screen.getByText(/No persisted branch decision/)).toBeTruthy();
    expect(screen.getByText(/ok · no record/)).toBeTruthy();
  });

  it("shows persisted BRANCH selection and skipped outgoing paths", () => {
    renderCard("route", branchDefinition, {
      nodeRun: nodeRun({
        id: "wn-route",
        workflowNodeKey: "route",
        status: "SUCCEEDED",
        selectedTargetKey: "ok",
      }),
      nodeRuns: [
        nodeRun({
          id: "wn-route",
          workflowNodeKey: "route",
          status: "SUCCEEDED",
          selectedTargetKey: "ok",
        }),
        nodeRun({
          id: "wn-fallback",
          workflowNodeKey: "fallback",
          status: "SKIPPED",
        }),
      ],
    });
    expect(screen.getByText(/Persisted selected path/)).toBeTruthy();
    expect(screen.getByText(/fallback · SKIPPED/)).toBeTruthy();
  });

  it("shows PARALLEL partial completion independently", () => {
    renderCard("fork", parallelDefinition, {
      nodeRun: nodeRun({
        id: "wn-fork",
        workflowNodeKey: "fork",
        status: "SUCCEEDED",
      }),
      nodeRuns: [
        nodeRun({
          id: "wn-left",
          workflowNodeKey: "left",
          status: "SUCCEEDED",
        }),
        nodeRun({
          id: "wn-right",
          workflowNodeKey: "right",
          status: "RUNNING",
        }),
      ],
    });
    expect(screen.getByText(/left · SUCCEEDED/)).toBeTruthy();
    expect(screen.getByText(/right · RUNNING/)).toBeTruthy();
  });

  it("shows PARALLEL sibling failure without collapsing the other child", () => {
    renderCard("fork", parallelDefinition, {
      nodeRun: nodeRun({
        id: "wn-fork",
        workflowNodeKey: "fork",
        status: "SUCCEEDED",
      }),
      nodeRuns: [
        nodeRun({
          id: "wn-left",
          workflowNodeKey: "left",
          status: "FAILED",
          error: { code: "CHILD_RUN_FAILED", message: "left failed" },
        }),
        nodeRun({
          id: "wn-right",
          workflowNodeKey: "right",
          status: "RUNNING",
        }),
      ],
    });
    expect(screen.getByText(/left · FAILED/)).toBeTruthy();
    expect(screen.getByText(/right · RUNNING/)).toBeTruthy();
  });

  it("shows JOIN predecessors without treating SKIPPED as JOIN failure", () => {
    renderCard("join", parallelDefinition, {
      nodeRun: nodeRun({
        id: "wn-join",
        workflowNodeKey: "join",
        status: "PENDING",
      }),
      nodeRuns: [
        nodeRun({
          id: "wn-left",
          workflowNodeKey: "left",
          status: "SKIPPED",
        }),
      ],
    });
    expect(screen.getByText(/does not mean this JOIN failed/)).toBeTruthy();
    expect(screen.getByText(/left · SKIPPED/)).toBeTruthy();
    expect(screen.getByText(/right · no record/)).toBeTruthy();
  });

  it("keeps approval actions bound to the persisted request id", () => {
    const approvalDefinition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
      edges: [],
    };
    renderCard("review", approvalDefinition, {
      nodeRun: nodeRun({
        id: "wn-review",
        workflowNodeKey: "review",
        status: "WAITING",
      }),
      approvalRequest: { id: "ar-real", status: "PENDING" },
    });
    expect(screen.getByText("ar-real")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByText(/Open child Run/)).toBeNull();
  });

  it("hides approval buttons for viewers", () => {
    const approvalDefinition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
      edges: [],
    };
    renderCard("review", approvalDefinition, {
      canExecute: false,
      nodeRun: nodeRun({
        id: "wn-review",
        workflowNodeKey: "review",
        status: "WAITING",
      }),
      approvalRequest: { id: "ar-real", status: "PENDING" },
    });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/cannot submit approval decisions/)).toBeTruthy();
  });

  it("describes TIMER waits without a countdown", () => {
    const waitDefinition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 15000 },
        },
      ],
      edges: [],
    };
    renderCard("delay", waitDefinition, {
      nodeRun: nodeRun({
        id: "wn-delay",
        workflowNodeKey: "delay",
        status: "WAITING",
      }),
    });
    expect(screen.getByText("DURATION")).toBeTruthy();
    expect(screen.getByText("15000 ms")).toBeTruthy();
    expect(screen.getByText(/workers are not kept alive/i)).toBeTruthy();
    expect(screen.queryByText(/remaining/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Emit event" })).toBeNull();
  });
});
