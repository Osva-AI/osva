import { OsvaApiError } from "@osva-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateCanonicalDemoReadiness,
  normalizeWorkspaceId,
} from "../demo/canonical-readiness.js";
import { loadDemoServerOperatorEnv } from "../demo/demo-operator-env.js";
import type { CanonicalStateV1 } from "../scripts/lib/state.js";

vi.mock("../scripts/lib/state.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/lib/state.js")>();
  return {
    ...actual,
    readCanonicalState: vi.fn(),
  };
});

import { readCanonicalState } from "../scripts/lib/state.js";

const sampleState: CanonicalStateV1 = {
  schemaVersion: "1",
  workspaceId: "ws-canonical",
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
    mcpStdioEntry: "stdio.js",
  },
};

describe("normalizeWorkspaceId", () => {
  it("trims whitespace and BOM", () => {
    expect(normalizeWorkspaceId("\uFEFF  ws-1  ")).toBe("ws-1");
  });
});

describe("evaluateCanonicalDemoReadiness", () => {
  it("returns ready:true when state, workspace, and workflow pin verify", async () => {
    const verify = vi.fn(async () => undefined);
    const result = await evaluateCanonicalDemoReadiness({
      configuredWorkspaceId: "ws-canonical",
      state: sampleState,
      verifyWorkflowVersion: verify,
    });
    expect(result.ready).toBe(true);
    if (result.ready) {
      expect(result.workflowVersionId).toBe("wfv-1");
    }
    expect(verify).toHaveBeenCalledOnce();
  });

  it("returns STATE_FILE_MISSING when state is absent", async () => {
    const result = await evaluateCanonicalDemoReadiness({
      configuredWorkspaceId: "ws-canonical",
      state: null,
    });
    expect(result).toEqual({
      ready: false,
      reason: "STATE_FILE_MISSING",
      message: expect.stringContaining(".osva/canonical-state.json"),
    });
  });

  it("returns WORKSPACE_ID_MISMATCH for mismatched workspace", async () => {
    const result = await evaluateCanonicalDemoReadiness({
      configuredWorkspaceId: "ws-other",
      state: sampleState,
    });
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reason).toBe("WORKSPACE_ID_MISMATCH");
    }
  });

  it("returns WORKFLOW_VERSION_MISSING when OSVA has no pinned version", async () => {
    const result = await evaluateCanonicalDemoReadiness({
      configuredWorkspaceId: "ws-canonical",
      state: sampleState,
      verifyWorkflowVersion: vi.fn(async () => {
        throw new OsvaApiError(404, { status: "NOT_FOUND" });
      }),
    });
    expect(result).toMatchObject({
      ready: false,
      reason: "WORKFLOW_VERSION_MISSING",
    });
  });
});

describe("loadDemoServerOperatorEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(readCanonicalState).mockReset();
  });

  it("uses workspaceId from canonical state when OSVA_WORKSPACE_ID is omitted", async () => {
    process.env.OSVA_BASE_URL = "http://127.0.0.1:3000";
    process.env.OSVA_API_KEY = "test-key";
    delete process.env.OSVA_WORKSPACE_ID;
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);

    const env = await loadDemoServerOperatorEnv();
    expect(env.workspaceId).toBe("ws-canonical");
  });

  it("rejects OSVA_WORKSPACE_ID that does not match canonical state", async () => {
    process.env.OSVA_BASE_URL = "http://127.0.0.1:3000";
    process.env.OSVA_API_KEY = "test-key";
    process.env.OSVA_WORKSPACE_ID = "ws-other";
    vi.mocked(readCanonicalState).mockResolvedValue(sampleState);

    await expect(loadDemoServerOperatorEnv()).rejects.toThrow(
      /does not match/i,
    );
  });
});
