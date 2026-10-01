import type {
  ApprovalRequestId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildWorkflowRunInput } from "../scripts/lib/args.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import {
  ApprovalCommandError,
  buildWorkflowStatusView,
  extractAnalysisDetails,
  findPendingApprovalsForRun,
  renderWorkflowStatusLines,
  selectPendingApprovalForDecision,
  statusDisplaySymbol,
} from "../scripts/lib/workflow-status.js";
import { validAnalysisOutput } from "./fixtures.js";

function workflowRunFixture(
  overrides: Partial<{
    status: "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED";
    nodeStatuses: Record<string, string>;
    approvalStatus: "PENDING" | "APPROVED";
    output: unknown;
  }> = {},
) {
  const nodeStatuses = overrides.nodeStatuses ?? {};
  const nodeRuns = [
    "research",
    "analysis",
    "adoption-approval",
    "delivery-wait",
    "report",
  ].map((key, index) => ({
    id: `wnr-${key}` as WorkflowNodeRunId,
    workspaceId: "ws-1",
    workflowRunId: "wfr-1" as WorkflowRunId,
    workflowNodeKey: key,
    sequence: index + 1,
    status: (nodeStatuses[key] ?? "PENDING") as never,
    input: {},
    childRunId:
      key === "research" || key === "analysis"
        ? (`run-${key}` as RunId)
        : key === "report" &&
            (nodeStatuses.report === "SUCCEEDED" ||
              nodeStatuses.report === "RUNNING")
          ? (`run-${key}` as RunId)
          : undefined,
    output:
      key === "analysis" && nodeStatuses.analysis === "SUCCEEDED"
        ? validAnalysisOutput
        : undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

  return {
    id: "wfr-1" as WorkflowRunId,
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowVersionId: "wfv-1",
    status: overrides.status ?? "WAITING",
    input: buildWorkflowRunInput({
      requestId: "req-1",
      packageName: "zod",
      useCase: "demo",
      constraints: [],
    }),
    output: overrides.output,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodeRuns,
    approvalRequests:
      overrides.approvalStatus === undefined
        ? []
        : [
            {
              id: "apr-1" as ApprovalRequestId,
              workspaceId: "ws-1",
              workflowRunId: "wfr-1" as WorkflowRunId,
              workflowNodeRunId: "wnr-adoption-approval" as WorkflowNodeRunId,
              status: overrides.approvalStatus,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              ...(overrides.approvalStatus === "APPROVED"
                ? {
                    decisionComment: "Proceed with report.",
                    decidedAt: "2026-01-01T00:01:00.000Z",
                  }
                : {}),
            },
          ],
  };
}

function fakeOperatorApi(
  attemptsByRun: Record<string, { sequence: number; status: string }[]>,
): OperatorApi {
  return {
    sdk: {
      runs: {
        listAttempts: vi.fn(async (runId: RunId) => ({
          attempts: (attemptsByRun[runId] ?? []).map((entry) => ({
            ...entry,
            id: `ra-${runId}-${entry.sequence}`,
            runId,
            createdAt: "2026-01-01T00:00:00.000Z",
          })),
        })),
      },
      artifacts: {
        get: vi.fn(async () => ({
          id: "artifact-1",
          workspaceId: "ws-1",
          name: "report.md",
          mediaType: "text/markdown",
          sizeBytes: 42,
          digest: "sha256:" + "a".repeat(64),
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
        })),
      },
    },
  } as unknown as OperatorApi;
}

describe("canonical operator: run behavior", () => {
  it("builds frozen workflow input without setup metadata", () => {
    const input = buildWorkflowRunInput({
      requestId: "11111111-1111-4111-8111-111111111111",
      packageName: "zod",
      useCase: "Runtime validation",
      constraints: ["Must be suitable for production"],
    });
    expect(input).toEqual({
      schemaVersion: "1",
      request: {
        requestId: "11111111-1111-4111-8111-111111111111",
        packageName: "zod",
        useCase: "Runtime validation",
        constraints: ["Must be suitable for production"],
      },
    });
    expect(Object.keys(input)).toEqual(["schemaVersion", "request"]);
  });
});

describe("canonical operator: status view", () => {
  it("maps symbols without inventing server state", () => {
    expect(statusDisplaySymbol("SUCCEEDED")).toBe("✓");
    expect(statusDisplaySymbol("FAILED")).toBe("✗");
    expect(statusDisplaySymbol("WAITING")).toBe("◷");
    expect(statusDisplaySymbol("RUNNING")).toBe("…");
    expect(statusDisplaySymbol("NOT_STARTED")).toBe("-");
  });

  it("renders canonical node order for WAITING approval", async () => {
    const run = workflowRunFixture({
      status: "WAITING",
      nodeStatuses: {
        research: "SUCCEEDED",
        analysis: "SUCCEEDED",
        "adoption-approval": "WAITING",
      },
      approvalStatus: "PENDING",
    });
    const api = fakeOperatorApi({
      "run-research": [{ sequence: 1, status: "SUCCEEDED" }],
      "run-analysis": [{ sequence: 1, status: "SUCCEEDED" }],
    });
    const view = await buildWorkflowStatusView(
      api,
      run as never,
      new Map([["adoption-approval", "Approve dependency adoption analysis"]]),
    );
    const text = renderWorkflowStatusLines(view).join("\n");
    expect(text).toContain("Research          ✓ SUCCEEDED");
    expect(text).toContain("Analysis          ✓ SUCCEEDED");
    expect(text).toContain("Approval          ◷ WAITING");
    expect(text).toContain("Delivery Event    - PENDING");
    expect(extractAnalysisDetails(validAnalysisOutput)?.recommendation).toBe(
      "PILOT",
    );
    expect(text).toContain("Recommendation: PILOT");
    expect(text).toContain("Approval:");
    expect(text).toContain("Title:    Approve dependency adoption analysis");
  });

  it("renders terminal workflow report artifact reference", async () => {
    const run = workflowRunFixture({
      status: "SUCCEEDED",
      nodeStatuses: {
        research: "SUCCEEDED",
        analysis: "SUCCEEDED",
        "adoption-approval": "SUCCEEDED",
        "delivery-wait": "SUCCEEDED",
        report: "SUCCEEDED",
      },
      output: {
        schemaVersion: "1",
        requestId: "req-1",
        disposition: "PILOT",
        summary: "Proceed with a time-boxed pilot.",
        artifact: { type: "artifact", artifactId: "artifact-1" },
      },
    });
    const api = fakeOperatorApi({});
    const view = await buildWorkflowStatusView(api, run as never, new Map());
    const text = renderWorkflowStatusLines(view).join("\n");
    expect(text).toContain("Workflow: SUCCEEDED");
    expect(text).toContain("Disposition: PILOT");
    expect(text).toContain("ID: artifact-1");
    expect(text).toContain("Name: report.md");
  });
});

describe("canonical operator: approve behavior", () => {
  it("finds exactly one pending approval", () => {
    const run = workflowRunFixture({
      approvalStatus: "PENDING",
    });
    expect(findPendingApprovalsForRun(run as never)).toHaveLength(1);
    expect(selectPendingApprovalForDecision(run as never).id).toBe("apr-1");
  });

  it("fails when approval already decided", () => {
    const run = workflowRunFixture({
      approvalStatus: "APPROVED",
    });
    expect(() => selectPendingApprovalForDecision(run as never)).toThrow(
      ApprovalCommandError,
    );
  });

  it("fails safely for multiple pending approvals", () => {
    const run = workflowRunFixture({ approvalStatus: "PENDING" });
    run.approvalRequests.push({
      ...run.approvalRequests[0]!,
      id: "apr-2" as ApprovalRequestId,
    });
    expect(() => selectPendingApprovalForDecision(run as never)).toThrow(
      /Multiple pending/,
    );
  });

  it("fails for terminal workflow", () => {
    const run = workflowRunFixture({
      status: "SUCCEEDED",
      approvalStatus: "PENDING",
    });
    expect(() => selectPendingApprovalForDecision(run as never)).toThrow(
      /terminal/,
    );
  });
});
