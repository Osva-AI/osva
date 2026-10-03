import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildWorkflowRunInput } from "../scripts/lib/args.js";
import {
  OperatorApi,
  OperatorSetupError,
} from "../scripts/lib/operator-client.js";
import type { OperatorEnv } from "../scripts/lib/operator-env.js";
import { readCanonicalState } from "../scripts/lib/state.js";
import type { CanonicalStateV1 } from "../scripts/lib/state.js";

vi.mock("../scripts/lib/state.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/lib/state.js")>();
  return {
    ...actual,
    readCanonicalState: vi.fn(),
  };
});

const env: OperatorEnv = {
  baseUrl: "http://127.0.0.1:3000",
  apiKey: "test-key",
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

describe("OperatorApi.loadVerifiedCanonicalState", () => {
  beforeEach(() => {
    vi.mocked(readCanonicalState).mockReset();
  });

  it("fails when state file is missing", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(null);
    const api = new OperatorApi(env);
    await expect(
      api.loadVerifiedCanonicalState(env.workspaceId),
    ).rejects.toBeInstanceOf(OperatorSetupError);
  });

  it("verifies workflow version through public API", async () => {
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);
    const api = new OperatorApi(env);
    const getVersion = vi
      .fn()
      .mockResolvedValue({ id: sampleState.workflowVersionId });
    api.sdk.workflows.getVersion = getVersion as never;

    const loaded = await api.loadVerifiedCanonicalState(env.workspaceId);
    expect(loaded.workflowVersionId).toBe("wfv-1");
    expect(getVersion).toHaveBeenCalledWith("wf-1", "wfv-1");
  });
});

describe("OperatorApi workflow run create", () => {
  it("creates one workflow run with frozen input only", async () => {
    const api = new OperatorApi(env);
    const create = vi.fn().mockResolvedValue({
      id: "wfr-new",
      status: "RUNNING",
    });
    api.sdk.workflowRuns.create = create as never;

    const input = buildWorkflowRunInput({
      requestId: "11111111-1111-4111-8111-111111111111",
      packageName: "zod",
      useCase: "demo",
      constraints: [],
    });

    await api.sdk.workflowRuns.create({
      workflowVersionId: sampleState.workflowVersionId as never,
      input,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      workflowVersionId: "wfv-1",
      input,
    });
  });
});

describe("OperatorApi workflow events", () => {
  it("posts stable delivery event body", async () => {
    const api = new OperatorApi(env);
    const request = vi.fn().mockResolvedValue({
      id: "evt-1",
      workspaceId: "ws-1",
      source: "canonical-demo",
      eventType: "report.delivery_requested",
      correlationKey: "req-1",
      idempotencyKey: "canonical-demo:delivery:req-1",
      payload: { requestedBy: "canonical-demo-cli" },
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    api.http.request = request as never;

    const event = await api.ingestWorkflowEvent({
      source: "canonical-demo",
      eventType: "report.delivery_requested",
      correlationKey: "req-1",
      idempotencyKey: "canonical-demo:delivery:req-1",
      payload: { requestedBy: "canonical-demo-cli" },
    });

    expect(event.id).toBe("evt-1");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/workflow-events",
      body: {
        source: "canonical-demo",
        eventType: "report.delivery_requested",
        correlationKey: "req-1",
        idempotencyKey: "canonical-demo:delivery:req-1",
        payload: { requestedBy: "canonical-demo-cli" },
      },
    });
  });
});
