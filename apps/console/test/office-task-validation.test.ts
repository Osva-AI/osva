import { describe, expect, it } from "vitest";

import {
  agentVersionsForWorker,
  isAgentVersionCompatibleWithWorker,
  parseOfficeTaskInputJson,
  workflowVersionsForWorkspace,
} from "../src/client/lib/office-task-validation.js";

describe("parseOfficeTaskInputJson", () => {
  it("rejects empty input", () => {
    expect(parseOfficeTaskInputJson("   ")).toEqual({
      ok: false,
      message: "Task input is required. Use {} for empty input.",
    });
  });

  it("rejects malformed JSON", () => {
    const result = parseOfficeTaskInputJson("{bad");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts valid JSON", () => {
    expect(parseOfficeTaskInputJson('{"prompt":"hi"}')).toEqual({
      ok: true,
      value: { prompt: "hi" },
    });
  });
});

describe("version compatibility helpers", () => {
  const versions = [
    {
      id: "av-1",
      agentId: "agent-a",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "av-2",
      agentId: "agent-b",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("filters agent versions for worker agent", () => {
    expect(
      agentVersionsForWorker("agent-a", versions).map((v) => v.id),
    ).toEqual(["av-1"]);
  });

  it("rejects incompatible agent version selection", () => {
    expect(
      isAgentVersionCompatibleWithWorker("av-2", "agent-a", versions),
    ).toBe(false);
    expect(
      isAgentVersionCompatibleWithWorker("av-1", "agent-a", versions),
    ).toBe(true);
  });

  it("filters workflow versions to workspace", () => {
    const workflowVersions = [
      {
        id: "wv-1",
        workflowId: "wf-1",
        workspaceId: "ws-1",
        version: 1,
        definition: { schemaVersion: "3", nodes: [], edges: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "wv-2",
        workflowId: "wf-2",
        workspaceId: "ws-2",
        version: 1,
        definition: { schemaVersion: "3", nodes: [], edges: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(
      workflowVersionsForWorkspace(workflowVersions, "ws-1").map((v) => v.id),
    ).toEqual(["wv-1"]);
  });
});
