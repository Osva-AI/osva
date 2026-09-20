import { describe, expect, it, vi } from "vitest";
import type { ExecutionRequest, GenerateTextRequest } from "@osva/contracts";
import {
  MemoryModelProfileRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import { ModelProfile, ModelProfileVersion } from "@osva/domain";
import { ModelGateway } from "@osva/model-gateway";

import { createRunStepRecorder } from "../src/run-step-recorder.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("RunStepRecorder", () => {
  it("records a succeeded model step with usage metadata only", async () => {
    const runs = new MemoryRunRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const modelProfileVersionId =
      "mpv-1" as import("@osva/contracts").ModelProfileVersionId;

    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-1" as import("@osva/contracts").ModelProfileId,
        workspaceId: "ws-1" as import("@osva/contracts").WorkspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId: "mp-1" as import("@osva/contracts").ModelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-test",
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
        },
        createdAt: NOW,
      }),
    );

    const execution: ExecutionRequest = {
      runId: "run-1" as import("@osva/contracts").RunId,
      runAttemptId: "attempt-1" as import("@osva/contracts").RunAttemptId,
      workspaceId: "ws-1" as import("@osva/contracts").WorkspaceId,
      agentId: "agent-1" as import("@osva/contracts").AgentId,
      agentVersionId: "av-1" as import("@osva/contracts").AgentVersionId,
      timeoutMs: 30_000,
      input: { prompt: "hello" },
      effectiveConfig: {},
      runtime: {
        type: "TRUSTED_TYPESCRIPT",
        entrypoint: "agent.ts",
        integrity: "sha256:00",
      },
      modelProfileVersionBindings: { default: modelProfileVersionId },
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: {},
      toolGrants: [],
      policyContext: {},
    };

    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "hello",
        usage: {
          inputTokens: 120,
          outputTokens: 15,
          totalTokens: 135,
          cachedInputTokens: 8,
        },
      })),
      generateText: vi.fn(),
    } as unknown as ModelGateway;

    const recorder = createRunStepRecorder(execution, {
      runs,
      modelProfiles,
      clock: { now: () => NOW },
      ids: { createId: () => "step-1" },
    });

    const wrapped = recorder.wrapModelGateway(inner);
    const request: GenerateTextRequest = {
      modelProfileVersionId,
      messages: [{ role: "user", content: "hello" }],
    };

    const result = await wrapped.generateText(request);
    expect(result).toEqual({ text: "hello" });

    const steps = runs.snapshotRunSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("MODEL");
    expect(steps[0]?.bindingName).toBe("default");
    expect(steps[0]?.status).toBe("SUCCEEDED");
    expect(steps[0]?.inputTokens).toBe(120);
    expect(steps[0]?.estimatedCostUsdMicros).toBe(150);
    expect(steps[0]).not.toHaveProperty("metadata");
  });

  it("records a succeeded knowledge step without query text", async () => {
    const runs = new MemoryRunRepository();
    const execution: ExecutionRequest = {
      runId: "run-1" as import("@osva/contracts").RunId,
      runAttemptId: "attempt-1" as import("@osva/contracts").RunAttemptId,
      workspaceId: "ws-1" as import("@osva/contracts").WorkspaceId,
      agentId: "agent-1" as import("@osva/contracts").AgentId,
      agentVersionId: "av-1" as import("@osva/contracts").AgentVersionId,
      timeoutMs: 30_000,
      input: { prompt: "hello" },
      effectiveConfig: {},
      runtime: {
        type: "TRUSTED_TYPESCRIPT",
        entrypoint: "agent.ts",
        integrity: "sha256:00",
      },
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: {
        docs: ["idx-1" as import("@osva/contracts").KnowledgeIndexId],
      },
      toolGrants: [],
      policyContext: {},
    };

    const inner = {
      search: vi.fn(async () => [
        {
          knowledgeChunkId:
            "chunk-1" as import("@osva/contracts").KnowledgeChunkId,
          knowledgeIndexId:
            "idx-1" as import("@osva/contracts").KnowledgeIndexId,
          knowledgeSourceId:
            "src-1" as import("@osva/contracts").KnowledgeSourceId,
          artifactReference: {
            type: "artifact" as const,
            artifactId: "art-1" as import("@osva/contracts").ArtifactId,
          },
          text: "fact",
          score: 0.9,
          attributes: {},
        },
      ]),
    };

    const recorder = createRunStepRecorder(execution, {
      runs,
      modelProfiles: new MemoryModelProfileRepository(),
      clock: { now: () => NOW },
      ids: { createId: () => "step-knowledge-1" },
    });

    const hits = await recorder.wrapKnowledgeGateway(inner).search("docs", {
      query: "secret query",
    });
    expect(hits).toHaveLength(1);

    const steps = runs.snapshotRunSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("KNOWLEDGE");
    expect(steps[0]?.bindingName).toBe("docs");
    expect(steps[0]?.status).toBe("SUCCEEDED");
    expect(JSON.stringify(steps[0])).not.toContain("secret query");
  });
});
