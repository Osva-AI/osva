import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoServer } from "../demo/server.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import type { CanonicalStateV1 } from "../scripts/lib/state.js";
import { validReportOutput, validWorkflowInput } from "./fixtures.js";

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

const WORKFLOW_RUN_ID = "03b289e2-e19a-4bf2-a09b-7fc2e94bfeae";
const ARTIFACT_ID = "b9f85539-4163-401b-a69f-0ffce57e8c21";
const REPORT_RUN_ID = "run-report-canonical";
const REPORT_ATTEMPT_ID = "ra-report-1";

const REPORT_MARKDOWN =
  "# Dependency adoption review\n\n<script>alert('xss')</script>\n\nOSVA_API_KEY must stay server-side.\n";

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

function succeededWorkflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKFLOW_RUN_ID,
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowVersionId: "wfv-1",
    status: "SUCCEEDED",
    input: validWorkflowInput,
    output: {
      ...validReportOutput,
      artifact: { type: "artifact", artifactId: ARTIFACT_ID },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:05:00.000Z",
    completedAt: "2026-01-01T00:05:00.000Z",
    nodeRuns: [
      {
        id: "wnr-report",
        workflowNodeKey: "report",
        status: "SUCCEEDED",
        childRunId: REPORT_RUN_ID,
        completedAt: "2026-01-01T00:05:00.000Z",
      },
    ],
    approvalRequests: [],
    ...overrides,
  };
}

function artifactResource(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    workspaceId: "ws-1",
    name: "dependency-adoption-review-zod-req-canonical-demo-001.md",
    mediaType: "text/markdown",
    sizeBytes: Buffer.byteLength(REPORT_MARKDOWN, "utf8"),
    digest: "sha256:" + "d".repeat(64),
    metadata: {
      kind: "osva.canonical.dependency-adoption-review",
    },
    producer: {
      runId: REPORT_RUN_ID,
      runAttemptId: REPORT_ATTEMPT_ID,
    },
    createdAt: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

function buildReportArtifactApi(
  workflowRun: ReturnType<typeof succeededWorkflowRun>,
): OperatorApi {
  const getArtifact = vi.fn(async () => artifactResource());
  const download = vi.fn(async () => ({
    status: 200,
    headers: new Headers({ "content-type": "text/markdown" }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(REPORT_MARKDOWN));
        controller.close();
      },
    }),
  }));

  return {
    sdk: {
      workflowRuns: {
        get: vi.fn(async () => workflowRun),
      },
      workflows: {
        getVersion: vi.fn(async () => ({
          id: "wfv-1",
          definition: { schemaVersion: "3", nodes: [], edges: [] },
        })),
      },
      runs: {
        listAttempts: vi.fn(async () => ({
          attempts: [
            {
              id: REPORT_ATTEMPT_ID,
              sequence: 1,
              status: "SUCCEEDED",
              output: {
                ...validReportOutput,
                artifact: { type: "artifact", artifactId: ARTIFACT_ID },
              },
            },
          ],
        })),
      },
      artifacts: {
        get: getArtifact,
        download,
      },
    },
    http: { request: vi.fn() },
  } as unknown as OperatorApi;
}

describe("canonical demo report artifact routes (M7.5)", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer !== undefined) {
      await closeServer();
      closeServer = undefined;
    }
    vi.mocked(readCanonicalState).mockReset();
  });

  it("returns metadata and persisted Markdown preview scoped to workflow run", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      metadata: Record<string, unknown>;
      content: string;
    };

    expect(body.metadata.artifactId).toBe(ARTIFACT_ID);
    expect(body.metadata.name).toContain("dependency-adoption-review");
    expect(body.metadata.mediaType).toBe("text/markdown");
    expect(body.content).toBe(REPORT_MARKDOWN);
    expect(body.content).toContain("<script>");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-test-key");
    expect(serialized).not.toContain("workspaceId");
    expect(serialized).not.toContain("/var/");
    expect(serialized).not.toContain("postgres://");
  });

  it("downloads exact artifact bytes with safe filename and media type", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact/download`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain(
      "dependency-adoption-review-zod",
    );
    expect(await response.text()).toBe(REPORT_MARKDOWN);
  });

  it("does not expose report artifact before report node succeeds", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(
      succeededWorkflowRun({
        nodeRuns: [
          {
            id: "wnr-report",
            workflowNodeKey: "report",
            status: "RUNNING",
            childRunId: REPORT_RUN_ID,
          },
        ],
      }),
    );

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact`,
    );
    expect(response.status).toBe(404);
  });

  it("rejects artifacts whose producer run does not match report child run", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());
    vi.mocked(api.sdk.artifacts.get).mockResolvedValue(
      artifactResource({
        producer: {
          runId: "run-other-workflow",
          runAttemptId: REPORT_ATTEMPT_ID,
        },
      }) as never,
    );

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact`,
    );
    expect(response.status).toBe(403);
  });

  it("rejects non-markdown report artifacts", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());
    vi.mocked(api.sdk.artifacts.get).mockResolvedValue(
      artifactResource({ mediaType: "application/pdf" }) as never,
    );

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact`,
    );
    expect(response.status).toBe(415);
  });

  it("rejects oversized report artifacts", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());
    vi.mocked(api.sdk.artifacts.get).mockResolvedValue(
      artifactResource({ sizeBytes: 2 * 1024 * 1024 }) as never,
    );

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}/report-artifact`,
    );
    expect(response.status).toBe(413);
  });

  it("completed read model reload includes artifact metadata for inspection", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = buildReportArtifactApi(succeededWorkflowRun());

    const server = createDemoServer({ env, apiFactory: () => api });
    const { port, close } = await listen(server);
    closeServer = close;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/canonical/runs/${WORKFLOW_RUN_ID}`,
    );
    expect(response.status).toBe(200);
    const model = (await response.json()) as {
      artifact?: { artifactId: string; name?: string };
      nodes: Array<{ key: string; persistedStatus?: string }>;
    };
    expect(model.artifact?.artifactId).toBe(ARTIFACT_ID);
    expect(
      model.nodes.find((node) => node.key === "report")?.persistedStatus,
    ).toBe("SUCCEEDED");
  });

  it("browser preview path renders Markdown as escaped text, not HTML", async () => {
    const appJs = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../demo/public/app.js",
      ),
      "utf8",
    );
    expect(appJs).toContain('createElement("pre")');
    expect(appJs).toContain("report-markdown-preview");
    expect(appJs).toMatch(
      /async function loadReportArtifactPreview\(previewPre, node, artifact\)\s*\{[\s\S]*?previewPre\.textContent[\s\S]*?reportPreviewContentByKey/,
    );
  });
});
