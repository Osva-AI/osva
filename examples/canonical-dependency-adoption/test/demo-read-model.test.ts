import type {
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildCanonicalDemoReadModel } from "../demo/read-model.js";
import { buildWorkflowRunInput } from "../scripts/lib/args.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import {
  deriveDeliveryWaitPresentation,
  extractWorkflowRequestFields,
} from "../scripts/lib/workflow-definition.js";
import {
  validAnalysisOutput,
  validReportOutput,
  validWorkflowInput,
} from "./fixtures.js";

const workflowDefinition = {
  schemaVersion: "3",
  nodes: [
    { key: "research", type: "AGENT" },
    { key: "analysis", type: "AGENT" },
    {
      key: "adoption-approval",
      type: "APPROVAL",
      title: "Approve dependency adoption analysis",
    },
    {
      key: "delivery-wait",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "canonical-demo",
        eventType: "report.delivery_requested",
        correlation: { kind: "INPUT_POINTER", pointer: "/request/requestId" },
        timeoutMs: 900_000,
      },
    },
    { key: "report", type: "AGENT" },
  ],
  edges: [],
};

function workflowRunFixture(
  overrides: Partial<{
    status: "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED";
    nodeStatuses: Record<string, string>;
    approvalStatus: "PENDING" | "APPROVED";
    output: unknown;
    includeAllNodes: boolean;
  }> = {},
) {
  const nodeStatuses = overrides.nodeStatuses ?? {};
  const keys = overrides.includeAllNodes
    ? ["research", "analysis", "adoption-approval", "delivery-wait", "report"]
    : Object.keys(nodeStatuses);

  const nodeRuns = keys.map((key, index) => ({
    id: `wnr-${key}` as WorkflowNodeRunId,
    workspaceId: "ws-1",
    workflowRunId: "wfr-1" as WorkflowRunId,
    workflowNodeKey: key,
    sequence: index + 1,
    status: (nodeStatuses[key] ?? "PENDING") as never,
    input: {},
    childRunId:
      key === "research" || key === "analysis" || key === "report"
        ? (`run-${key}` as RunId)
        : undefined,
    output:
      key === "analysis" && nodeStatuses.analysis === "SUCCEEDED"
        ? validAnalysisOutput
        : undefined,
    startedAt:
      nodeStatuses[key] === "RUNNING" || nodeStatuses[key] === "SUCCEEDED"
        ? "2026-01-01T00:00:10.000Z"
        : undefined,
    completedAt:
      nodeStatuses[key] === "SUCCEEDED"
        ? "2026-01-01T00:00:20.000Z"
        : undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

  return {
    id: "wfr-1" as WorkflowRunId,
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowVersionId: "wfv-1",
    status: overrides.status ?? "RUNNING",
    input: validWorkflowInput,
    output: overrides.output,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:01.000Z",
    completedAt:
      overrides.status === "SUCCEEDED" ? "2026-01-01T00:05:00.000Z" : undefined,
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

function fakeOperatorApi(options: {
  attemptsByRun?: Record<string, { sequence: number; status: string }[]>;
  stepsByAttempt?: Record<string, unknown[]>;
  runs?: Record<
    string,
    { status: string; agentId: string; agentVersionId: string }
  >;
  artifactGetFails?: boolean;
}): OperatorApi {
  const attemptsByRun = options.attemptsByRun ?? {};
  const stepsByAttempt = options.stepsByAttempt ?? {};
  const runs = options.runs ?? {};

  return {
    sdk: {
      runs: {
        get: vi.fn(async (runId: RunId) => {
          const run = runs[runId];
          if (run === undefined) {
            throw new Error("missing run");
          }
          return {
            id: runId,
            workspaceId: "ws-1",
            agentId: run.agentId,
            status: run.status,
            effectiveBindings: {
              agentVersionId: run.agentVersionId,
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          };
        }),
        listAttempts: vi.fn(async (runId: RunId) => ({
          attempts: (attemptsByRun[runId] ?? []).map((entry) => ({
            ...entry,
            id: `ra-${runId}-${entry.sequence}` as RunAttemptId,
            runId,
            createdAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:02.000Z",
            completedAt:
              entry.status === "SUCCEEDED"
                ? "2026-01-01T00:00:03.000Z"
                : undefined,
          })),
        })),
      },
      artifacts: {
        get: options.artifactGetFails
          ? vi.fn(async () => {
              throw new Error("artifact unavailable");
            })
          : vi.fn(async () => ({
              id: validReportOutput.artifact.artifactId,
              workspaceId: "ws-1",
              name: "report.md",
              mediaType: "text/markdown",
              sizeBytes: 128,
              digest: "sha256:" + "a".repeat(64),
              metadata: {},
              producer: {
                runId: "run-report" as RunId,
                runAttemptId: "ra-run-report-1" as RunAttemptId,
              },
              createdAt: "2026-01-01T00:00:00.000Z",
            })),
      },
    },
    http: {
      request: vi.fn(async ({ path }: { path: string }) => {
        const match = path.match(/attempts\/([^/]+)\/steps/);
        if (match !== null) {
          const attemptId = match[1]!;
          return { steps: stepsByAttempt[attemptId] ?? [] };
        }
        if (path.includes("/tools/")) {
          return {
            id: "tv-1",
            toolId: "tool-1",
            version: 1,
            type: "MCP",
            implementation: "MCP_V1",
            mcp: {
              connectorVersionId: "cv-1",
              toolName: "npm_package_metadata",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
          };
        }
        throw new Error(`unexpected path ${path}`);
      }),
    },
  } as unknown as OperatorApi;
}

describe("workflow definition helpers", () => {
  it("extracts request fields from workflow input", () => {
    expect(extractWorkflowRequestFields(validWorkflowInput)).toMatchObject({
      requestId: validWorkflowInput.request.requestId,
      packageName: "zod",
    });
  });

  it("derives delivery wait correlation from workflow input", () => {
    const wait = deriveDeliveryWaitPresentation(
      (workflowDefinition.nodes[3] as { wait: unknown }).wait,
      validWorkflowInput,
    );
    expect(wait).toMatchObject({
      eventType: "report.delivery_requested",
      correlationValue: validWorkflowInput.request.requestId,
    });
  });
});

describe("buildCanonicalDemoReadModel", () => {
  it("returns five canonical nodes with NOT_STARTED presentation when nodes are absent", async () => {
    const run = workflowRunFixture({
      status: "RUNNING",
      nodeStatuses: {},
      includeAllNodes: false,
    });
    run.nodeRuns = [];
    const api = fakeOperatorApi({});
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    expect(model.nodes).toHaveLength(5);
    expect(
      model.nodes.every((node) => node.presentationStatus === "NOT_STARTED"),
    ).toBe(true);
  });

  it("marks research running with child run and steps", async () => {
    const run = workflowRunFixture({
      status: "RUNNING",
      nodeStatuses: { research: "RUNNING" },
      includeAllNodes: true,
    });
    const api = fakeOperatorApi({
      attemptsByRun: { "run-research": [{ sequence: 1, status: "RUNNING" }] },
      runs: {
        "run-research": {
          status: "RUNNING",
          agentId: "agent-research",
          agentVersionId: "av-research",
        },
      },
      stepsByAttempt: {
        "ra-run-research-1": [
          {
            id: "step-1",
            runId: "run-research",
            runAttemptId: "ra-run-research-1",
            kind: "KNOWLEDGE",
            bindingName: "policy_docs",
            status: "SUCCEEDED",
            startedAt: "2026-01-01T00:00:02.000Z",
            completedAt: "2026-01-01T00:00:02.500Z",
          },
        ],
      },
    });

    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
      {
        toolVersionIdToToolId: new Map([["tv-1", "tool-1"]]),
      },
    );
    const research = model.nodes.find((node) => node.key === "research");
    expect(research?.presentationStatus).toBe("RUNNING");
    expect(research?.childRun?.steps[0]?.bindingName).toBe("policy_docs");
  });

  it("surfaces analysis recommendation from persisted output", async () => {
    const run = workflowRunFixture({
      status: "WAITING",
      nodeStatuses: {
        research: "SUCCEEDED",
        analysis: "SUCCEEDED",
        "adoption-approval": "WAITING",
      },
      approvalStatus: "PENDING",
      includeAllNodes: true,
    });
    const api = fakeOperatorApi({
      attemptsByRun: {
        "run-research": [{ sequence: 1, status: "SUCCEEDED" }],
        "run-analysis": [{ sequence: 1, status: "SUCCEEDED" }],
      },
      runs: {
        "run-research": {
          status: "SUCCEEDED",
          agentId: "a1",
          agentVersionId: "av1",
        },
        "run-analysis": {
          status: "SUCCEEDED",
          agentId: "a2",
          agentVersionId: "av2",
        },
      },
    });
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    const analysis = model.nodes.find((node) => node.key === "analysis");
    expect(analysis?.analysis?.recommendation).toBe("PILOT");
    const approval = model.nodes.find(
      (node) => node.key === "adoption-approval",
    );
    expect(approval?.approval?.status).toBe("PENDING");
  });

  it("includes delivery wait metadata while waiting", async () => {
    const run = workflowRunFixture({
      status: "WAITING",
      nodeStatuses: {
        research: "SUCCEEDED",
        analysis: "SUCCEEDED",
        "adoption-approval": "SUCCEEDED",
        "delivery-wait": "WAITING",
      },
      approvalStatus: "APPROVED",
      includeAllNodes: true,
    });
    const api = fakeOperatorApi({});
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    const waitNode = model.nodes.find((node) => node.key === "delivery-wait");
    expect(waitNode?.deliveryWait?.eventType).toBe("report.delivery_requested");
  });

  it("includes artifact metadata for succeeded workflow", async () => {
    const run = workflowRunFixture({
      status: "SUCCEEDED",
      nodeStatuses: {
        research: "SUCCEEDED",
        analysis: "SUCCEEDED",
        "adoption-approval": "SUCCEEDED",
        "delivery-wait": "SUCCEEDED",
        report: "SUCCEEDED",
      },
      approvalStatus: "APPROVED",
      output: validReportOutput,
      includeAllNodes: true,
    });
    const api = fakeOperatorApi({
      attemptsByRun: {
        "run-report": [{ sequence: 1, status: "SUCCEEDED" }],
      },
      runs: {
        "run-report": {
          status: "SUCCEEDED",
          agentId: "a3",
          agentVersionId: "av3",
        },
      },
    });
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    expect(model.artifact?.artifactId).toBe(
      validReportOutput.artifact.artifactId,
    );
    expect(model.artifact?.name).toBe("report.md");
  });

  it("keeps core workflow fields when artifact enrichment fails", async () => {
    const run = workflowRunFixture({
      status: "SUCCEEDED",
      nodeStatuses: { report: "SUCCEEDED" },
      output: validReportOutput,
      includeAllNodes: true,
    });
    const api = fakeOperatorApi({ artifactGetFails: true });
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    expect(model.workflowStatus).toBe("SUCCEEDED");
    expect(model.artifact?.artifactId).toBe(
      validReportOutput.artifact.artifactId,
    );
    expect(model.artifact?.name).toBeUndefined();
  });

  it("handles missing child run fetches without corrupting workflow status", async () => {
    const run = {
      ...workflowRunFixture({
        status: "FAILED",
        nodeStatuses: { research: "FAILED" },
        includeAllNodes: true,
      }),
      error: { code: "NODE_FAILED", message: "Research failed" },
    };
    const api = fakeOperatorApi({});
    const model = await buildCanonicalDemoReadModel(
      api,
      run as never,
      workflowDefinition,
    );
    expect(model.workflowStatus).toBe("FAILED");
    expect(model.workflowError?.code).toBe("NODE_FAILED");
    expect(
      model.nodes.find((node) => node.key === "research")?.childRun,
    ).toBeUndefined();
  });
});
