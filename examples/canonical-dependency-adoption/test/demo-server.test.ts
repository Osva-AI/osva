import type { Server } from "node:http";

import { OsvaApiError } from "@osva-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoServer } from "../demo/server.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import type { CanonicalStateV1 } from "../scripts/lib/state.js";
import {
  validAnalysisOutput,
  validResearchOutput,
  validWorkflowInput,
} from "./fixtures.js";

vi.mock("../scripts/lib/state.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/lib/state.js")>();
  return {
    ...actual,
    readCanonicalState: vi.fn(),
  };
});

import { readCanonicalState } from "../scripts/lib/state.js";

const env = {
  baseUrl: "http://127.0.0.1:3000",
  apiKey: "super-secret-test-key",
  workspaceId: "ws-1",
  requestTimeoutMs: 5_000,
};

const sampleState: CanonicalStateV1 = {
  schemaVersion: "1",
  workspaceId: "ws-1",
  modelProfileId: "mp-1",
  modelProfileVersionId: "mpv-1",
  policyArtifactId: "artifact-1",
  knowledgeSourceId: "ks-1",
  knowledgeIndexId: "ki-1",
  connectorId: "conn-1",
  connectorVersionId: "connv-1",
  tools: {
    npmPackageMetadata: { toolId: "tool-1", toolVersionId: "tv-1" },
    npmDownloads: { toolId: "tool-2", toolVersionId: "tv-2" },
  },
  agents: {
    research: { agentId: "a-1", agentVersionId: "av-1" },
    analysis: { agentId: "a-2", agentVersionId: "av-2" },
    report: { agentId: "a-3", agentVersionId: "av-3" },
  },
  workflowId: "wf-1",
  workflowVersionId: "wfv-1",
  trustedRuntime: {
    researchIntegrity: "sha256:" + "a".repeat(64),
    analysisIntegrity: "sha256:" + "b".repeat(64),
    reportIntegrity: "sha256:" + "c".repeat(64),
    mcpStdioEntry: "entry.js",
  },
};

function listen(
  server: Server,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected numeric server address."));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error === undefined ? closeResolve() : closeReject(error),
            );
          }),
      });
    });
  });
}

describe("canonical demo server", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer !== undefined) {
      await closeServer();
      closeServer = undefined;
    }
    vi.mocked(readCanonicalState).mockReset();
  });

  it("serves UI assets", async () => {
    const server = createDemoServer({ env });
    const { port, close } = await listen(server);
    closeServer = close;

    const html = await fetch(`http://127.0.0.1:${port}/`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Canonical Dependency Adoption Review");

    const js = await fetch(`http://127.0.0.1:${port}/app.js`);
    expect(js.status).toBe(200);
  });

  it("returns safe canonical setup state", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api: OperatorApi = {
      sdk: {
        workflows: {
          getVersion: vi.fn(async () => ({
            id: sampleState.workflowVersionId,
          })),
        },
      },
    } as unknown as OperatorApi;

    const server = createDemoServer({
      env,
      apiFactory: () => api,
    });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/state`,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ready).toBe(true);
    expect(body.workflowVersionId).toBe(sampleState.workflowVersionId);
    expect(JSON.stringify(body)).not.toContain("super-secret-test-key");
    expect(JSON.stringify(body)).not.toContain("trustedRuntime");
  });

  it("returns WORKSPACE_ID_MISMATCH reason without exposing secrets", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const server = createDemoServer({
      env: { ...env, workspaceId: "ws-other" },
      apiFactory: () =>
        ({
          sdk: { workflows: { getVersion: vi.fn() } },
        }) as unknown as OperatorApi,
    });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/state`,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ready).toBe(false);
    expect(body.reason).toBe("WORKSPACE_ID_MISMATCH");
    expect(JSON.stringify(body)).not.toContain("super-secret-test-key");
  });

  it("returns STATE_FILE_MISSING when canonical state is absent", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(null);
    const server = createDemoServer({
      env,
      apiFactory: () =>
        ({
          sdk: { workflows: { getVersion: vi.fn() } },
        }) as unknown as OperatorApi,
    });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/state`,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ready: false,
      reason: "STATE_FILE_MISSING",
    });
  });

  it("creates workflow runs through the API boundary", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const create = vi.fn(async () => ({
      id: "wfr-created",
      status: "RUNNING",
    }));
    const api: OperatorApi = {
      loadVerifiedCanonicalState: vi.fn(async () => sampleState),
      sdk: {
        workflowRuns: { create },
      },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: "zod",
          useCase: "demo",
          constraints: ["c1"],
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.workflowRunId).toBe("wfr-created");
    expect(create).toHaveBeenCalledWith({
      workflowVersionId: "wfv-1",
      input: expect.objectContaining({
        request: expect.objectContaining({ packageName: "zod" }),
      }),
    });
  });

  it("returns 404 for missing workflow runs without leaking secrets", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const get = vi.fn(async () => {
      throw new OsvaApiError(404, { status: "NOT_FOUND" });
    });
    const api: OperatorApi = {
      sdk: {
        workflowRuns: { get },
        workflows: { getVersion: vi.fn() },
      },
      http: { request: vi.fn() },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-missing`,
    );
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("super-secret-test-key");
  });

  it("returns aggregated workflow read model JSON", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            workspaceId: "ws-1",
            workflowId: "wf-1",
            workflowVersionId: "wfv-1",
            status: "RUNNING",
            input: validWorkflowInput,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            nodeRuns: [],
            approvalRequests: [],
          })),
        },
        workflows: {
          getVersion: vi.fn(async () => ({
            id: "wfv-1",
            definition: { schemaVersion: "3", nodes: [], edges: [] },
          })),
        },
        runs: {
          listAttempts: vi.fn(async () => ({ attempts: [] })),
        },
        artifacts: { get: vi.fn() },
      },
      http: { request: vi.fn() },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.workflowRunId).toBe("wfr-1");
    expect(body.nodes).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain("super-secret-test-key");
  });

  it("returns 200 for waiting approval with run steps and token fields (M7.3 regression)", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const workflowRun = {
      id: "03b289e2-e19a-4bf2-a09b-7fc2e94bfeae",
      workspaceId: "ws-1",
      workflowId: "wf-1",
      workflowVersionId: "wfv-1",
      status: "WAITING",
      input: validWorkflowInput,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      nodeRuns: [
        {
          id: "wnr-research",
          workflowNodeKey: "research",
          status: "SUCCEEDED",
          childRunId: "run-research",
          startedAt: "2026-01-01T00:00:02.000Z",
          completedAt: "2026-01-01T00:00:10.000Z",
        },
        {
          id: "wnr-analysis",
          workflowNodeKey: "analysis",
          status: "SUCCEEDED",
          childRunId: "run-analysis",
          output: validAnalysisOutput,
          startedAt: "2026-01-01T00:00:11.000Z",
          completedAt: "2026-01-01T00:00:20.000Z",
        },
        {
          id: "wnr-approval",
          workflowNodeKey: "adoption-approval",
          status: "WAITING",
        },
        {
          id: "wnr-delivery",
          workflowNodeKey: "delivery-wait",
          status: "PENDING",
        },
        {
          id: "wnr-report",
          workflowNodeKey: "report",
          status: "PENDING",
        },
      ],
      approvalRequests: [
        {
          id: "apr-1",
          workflowRunId: "03b289e2-e19a-4bf2-a09b-7fc2e94bfeae",
          workflowNodeRunId: "wnr-approval",
          status: "PENDING",
          title: "Approve dependency adoption analysis",
        },
      ],
    };

    const httpRequest = vi.fn(async ({ path }: { path: string }) => {
      const stepsMatch = path.match(/attempts\/([^/]+)\/steps/);
      if (stepsMatch !== null) {
        const attemptId = stepsMatch[1]!;
        const stepsByAttempt: Record<string, unknown[]> = {
          "ra-run-research-1": [
            {
              id: "step-r-1",
              runId: "run-research",
              runAttemptId: "ra-run-research-1",
              kind: "KNOWLEDGE",
              bindingName: "policy_docs",
              status: "SUCCEEDED",
              startedAt: "2026-01-01T00:00:02.000Z",
              completedAt: "2026-01-01T00:00:03.000Z",
              inputTokens: 900,
              outputTokens: 120,
              totalTokens: 1020,
            },
          ],
          "ra-run-analysis-1": [
            {
              id: "step-a-1",
              runId: "run-analysis",
              runAttemptId: "ra-run-analysis-1",
              kind: "MODEL",
              bindingName: "analysis_model",
              status: "SUCCEEDED",
              startedAt: "2026-01-01T00:00:12.000Z",
              completedAt: "2026-01-01T00:00:18.000Z",
              inputTokens: 2400,
              outputTokens: 512,
              totalTokens: 2912,
              estimatedCostUsdMicros: 42,
            },
          ],
        };
        return { steps: stepsByAttempt[attemptId] ?? [] };
      }
      if (path.includes("/tools/")) {
        return {
          id: "tv-1",
          toolId: "tool-1",
          version: 1,
          type: "MCP",
          implementation: "MCP_V1",
          mcp: { connectorVersionId: "cv-1", toolName: "npm_package_metadata" },
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => workflowRun),
        },
        workflows: {
          getVersion: vi.fn(async () => ({
            id: "wfv-1",
            definition: {
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
                    correlation: {
                      kind: "INPUT_POINTER",
                      pointer: "/request/requestId",
                    },
                    timeoutMs: 900_000,
                  },
                },
                { key: "report", type: "AGENT" },
              ],
              edges: [],
            },
          })),
        },
        runs: {
          get: vi.fn(async (runId: string) => ({
            id: runId,
            status: "SUCCEEDED",
            agentId: runId === "run-research" ? "a-1" : "a-2",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
          })),
          listAttempts: vi.fn(async (runId: string) => ({
            attempts: [
              {
                id: `ra-${runId}-1`,
                runId,
                sequence: 1,
                status: "SUCCEEDED",
                startedAt: "2026-01-01T00:00:02.000Z",
                completedAt: "2026-01-01T00:00:19.000Z",
                output:
                  runId === "run-research"
                    ? validResearchOutput
                    : validAnalysisOutput,
              },
            ],
          })),
        },
        artifacts: { get: vi.fn() },
      },
      http: { request: httpRequest },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const runUrl = `http://127.0.0.1:${port}/api/canonical/runs/${workflowRun.id}`;
    const first = await fetch(runUrl);
    expect(first.status).toBe(200);
    const body = (await first.json()) as Record<string, unknown>;
    expect(body.workflowStatus).toBe("WAITING");

    const nodes = body.nodes as Array<Record<string, unknown>>;
    const analysis = nodes.find((node) => node.key === "analysis") as {
      analysis?: {
        recommendation: string;
        confidence: string;
        summary: string;
      };
      childRun?: { steps: Array<{ totalTokens?: number }> };
    };
    expect(analysis?.analysis?.recommendation).toBe("PILOT");
    expect(analysis?.analysis?.confidence).toBe("MEDIUM");
    expect(analysis?.childRun?.steps[0]?.totalTokens).toBe(2912);

    const approval = nodes.find((node) => node.key === "adoption-approval") as {
      approval?: { status: string };
    };
    expect(approval?.approval?.status).toBe("PENDING");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-test-key");
    expect(serialized).not.toContain("OSVA_API_KEY");

    const reload = await fetch(runUrl);
    expect(reload.status).toBe(200);
    const reloaded = (await reload.json()) as Record<string, unknown>;
    expect(reloaded.workflowRunId).toBe(workflowRun.id);
    expect(reloaded.workflowStatus).toBe("WAITING");
  });

  it("proxies approval decisions without leaking the API key", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const decide = vi.fn(async () => ({
      id: "apr-1",
      status: "APPROVED",
    }));
    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            input: validWorkflowInput,
            approvalRequests: [
              {
                id: "apr-1",
                workflowRunId: "wfr-1",
                status: "PENDING",
              },
            ],
            nodeRuns: [],
          })),
        },
        approvals: { decide },
      },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: "apr-1",
          decision: "APPROVED",
          comment: "Proceed.",
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.approvalId).toBe("apr-1");
    expect(decide).toHaveBeenCalledWith("apr-1", {
      decision: "APPROVED",
      comment: "Proceed.",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-test-key");
    expect(serialized).not.toContain(env.apiKey);
  });

  it("rejects invalid approval ids without calling decide", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const decide = vi.fn();
    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            approvalRequests: [
              {
                id: "apr-1",
                workflowRunId: "wfr-1",
                status: "PENDING",
              },
            ],
            nodeRuns: [],
          })),
        },
        approvals: { decide },
      },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: "apr-wrong",
          decision: "APPROVED",
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("returns 409 when no pending approval exists", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const decide = vi.fn();
    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            approvalRequests: [
              {
                id: "apr-1",
                workflowRunId: "wfr-1",
                status: "APPROVED",
              },
            ],
            nodeRuns: [],
          })),
        },
        approvals: { decide },
      },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: "apr-1",
          decision: "APPROVED",
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(decide).not.toHaveBeenCalled();
  });

  it("emits canonical delivery events only while delivery wait is WAITING", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const ingestWorkflowEvent = vi.fn(async () => ({
      id: "wev-1",
      source: "canonical-demo",
      eventType: "report.delivery_requested",
    }));
    const api: OperatorApi = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            input: validWorkflowInput,
            nodeRuns: [{ workflowNodeKey: "delivery-wait", status: "WAITING" }],
            approvalRequests: [],
          })),
        },
      },
      ingestWorkflowEvent,
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/delivery-event`,
      { method: "POST" },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.eventType).toBe("report.delivery_requested");
    expect(body.source).toBe("canonical-demo");
    expect(ingestWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "canonical-demo",
        eventType: "report.delivery_requested",
        correlationKey: validWorkflowInput.request.requestId,
      }),
    );
    expect(JSON.stringify(body)).not.toContain("super-secret-test-key");
  });

  it("read model reflects post-approval delivery wait after reload", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    let phase: "approval" | "delivery" = "approval";
    const get = vi.fn(async () => {
      if (phase === "approval") {
        return {
          id: "wfr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wfv-1",
          status: "WAITING",
          input: validWorkflowInput,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          nodeRuns: [
            {
              id: "wnr-approval",
              workflowNodeKey: "adoption-approval",
              status: "WAITING",
            },
            {
              id: "wnr-delivery",
              workflowNodeKey: "delivery-wait",
              status: "PENDING",
            },
          ],
          approvalRequests: [
            {
              id: "apr-1",
              workflowRunId: "wfr-1",
              workflowNodeRunId: "wnr-approval",
              status: "PENDING",
            },
          ],
        };
      }
      return {
        id: "wfr-1",
        workspaceId: "ws-1",
        workflowId: "wf-1",
        workflowVersionId: "wfv-1",
        status: "WAITING",
        input: validWorkflowInput,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        nodeRuns: [
          {
            id: "wnr-approval",
            workflowNodeKey: "adoption-approval",
            status: "SUCCEEDED",
            completedAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "wnr-delivery",
            workflowNodeKey: "delivery-wait",
            status: "WAITING",
          },
        ],
        approvalRequests: [
          {
            id: "apr-1",
            workflowRunId: "wfr-1",
            workflowNodeRunId: "wnr-approval",
            status: "APPROVED",
            decidedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      };
    });

    const decide = vi.fn(async () => {
      phase = "delivery";
      return { id: "apr-1", status: "APPROVED" };
    });

    const api: OperatorApi = {
      sdk: {
        workflowRuns: { get },
        workflows: {
          getVersion: vi.fn(async () => ({
            id: "wfv-1",
            definition: {
              schemaVersion: "3",
              nodes: [
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
                    correlation: {
                      kind: "INPUT_POINTER",
                      pointer: "/request/requestId",
                    },
                  },
                },
              ],
              edges: [],
            },
          })),
        },
        runs: { listAttempts: vi.fn(async () => ({ attempts: [] })) },
        artifacts: { get: vi.fn() },
        approvals: { decide },
      },
      http: { request: vi.fn() },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const approvalResponse = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: "apr-1",
          decision: "APPROVED",
        }),
      },
    );
    expect(approvalResponse.status).toBe(200);

    const readResponse = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1`,
    );
    const model = (await readResponse.json()) as {
      nodes: Array<{ key: string; presentationStatus: string }>;
    };
    const approval = model.nodes.find(
      (node) => node.key === "adoption-approval",
    );
    const delivery = model.nodes.find((node) => node.key === "delivery-wait");
    expect(approval?.presentationStatus).toBe("SUCCEEDED");
    expect(delivery?.presentationStatus).toBe("WAITING");
  });

  it("read model moves delivery wait to succeeded after delivery event", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    let deliveryWaiting = true;
    const get = vi.fn(async () => ({
      id: "wfr-1",
      workspaceId: "ws-1",
      workflowId: "wf-1",
      workflowVersionId: "wfv-1",
      status: deliveryWaiting ? "WAITING" : "RUNNING",
      input: validWorkflowInput,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z",
      nodeRuns: [
        {
          id: "wnr-delivery",
          workflowNodeKey: "delivery-wait",
          status: deliveryWaiting ? "WAITING" : "SUCCEEDED",
          completedAt: deliveryWaiting ? undefined : "2026-01-01T00:00:02.000Z",
        },
        {
          id: "wnr-report",
          workflowNodeKey: "report",
          status: deliveryWaiting ? "PENDING" : "RUNNING",
        },
      ],
      approvalRequests: [],
    }));

    const ingestWorkflowEvent = vi.fn(async () => {
      deliveryWaiting = false;
      return {
        id: "wev-1",
        source: "canonical-demo",
        eventType: "report.delivery_requested",
      };
    });

    const api: OperatorApi = {
      sdk: {
        workflowRuns: { get },
        workflows: {
          getVersion: vi.fn(async () => ({
            id: "wfv-1",
            definition: {
              schemaVersion: "3",
              nodes: [
                {
                  key: "delivery-wait",
                  type: "WAIT",
                  wait: {
                    kind: "EVENT",
                    source: "canonical-demo",
                    eventType: "report.delivery_requested",
                    correlation: {
                      kind: "INPUT_POINTER",
                      pointer: "/request/requestId",
                    },
                  },
                },
                { key: "report", type: "AGENT" },
              ],
              edges: [],
            },
          })),
        },
        runs: { listAttempts: vi.fn(async () => ({ attempts: [] })) },
        artifacts: { get: vi.fn() },
      },
      ingestWorkflowEvent,
      http: { request: vi.fn() },
    } as unknown as OperatorApi;

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const emitResponse = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1/delivery-event`,
      { method: "POST" },
    );
    expect(emitResponse.status).toBe(201);

    const readResponse = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/wfr-1`,
    );
    const model = (await readResponse.json()) as {
      nodes: Array<{ key: string; presentationStatus: string }>;
    };
    const delivery = model.nodes.find((node) => node.key === "delivery-wait");
    const report = model.nodes.find((node) => node.key === "report");
    expect(delivery?.presentationStatus).toBe("SUCCEEDED");
    expect(report?.presentationStatus).toBe("RUNNING");
  });
});
