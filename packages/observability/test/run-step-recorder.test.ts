import {
  MODEL_ERROR_CODES,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentId,
  AgentVersionId,
  ExecutionRequest,
  GenerateTextRequest,
  KnowledgeIndexId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  MemoryModelProfileRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import {
  EffectiveRunBindings,
  ModelProfile,
  ModelProfileVersion,
  Run,
  RunAttempt,
} from "@osva/domain";
import { ModelGateway } from "@osva/model-gateway";

import { NO_OP_INSTRUMENTATION } from "../src/instrumentation.js";
import { OSVA_METRIC } from "../src/metrics.js";
import { createRunStepRecorder } from "../src/run-step-recorder.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");

const workspaceId = "ws-1" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const agentVersionId = "av-1" as AgentVersionId;
const runId = "run-1" as RunId;
const runAttemptId = "attempt-1" as RunAttemptId;

async function seedRunningRunAndAttempt(
  runs: MemoryRunRepository,
  bindings?: {
    readonly modelProfileVersionBindings?: Readonly<
      Record<string, ModelProfileVersionId>
    >;
    readonly knowledgeIndexBindings?: Readonly<
      Record<string, readonly KnowledgeIndexId[]>
    >;
  },
): Promise<void> {
  const pending = Run.create({
    id: runId,
    workspaceId,
    agentId,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId,
      modelProfileVersionBindings: bindings?.modelProfileVersionBindings ?? {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: bindings?.knowledgeIndexBindings ?? {},
    }),
    input: { prompt: "hello" },
    createdAt: NOW,
  });
  const attempt = RunAttempt.createFirst({
    id: runAttemptId,
    runId,
    createdAt: NOW,
  });

  await runs.createRunWithInitialAttempt(pending, attempt);
  const queuedRun = pending.transitionTo("QUEUED", LATER);
  await runs.transitionRun("PENDING", queuedRun);
  const runningRun = queuedRun.transitionTo("RUNNING", LATER);
  const runningAttempt = attempt.transitionTo("RUNNING", LATER);
  await runs.transitionRunAndAttempt(
    "QUEUED",
    runningRun,
    "PENDING",
    runningAttempt,
  );
}

describe("RunStepRecorder", () => {
  it("records a succeeded model step with usage metadata only", async () => {
    const runs = new MemoryRunRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const modelProfileVersionId = "mpv-1" as ModelProfileVersionId;

    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
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
    await seedRunningRunAndAttempt(runs, {
      modelProfileVersionBindings: { default: modelProfileVersionId },
    });

    const execution: ExecutionRequest = {
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
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
      generateCompletionOutcome: vi.fn(async () => ({
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
      })),
      generateTextOutcome: vi.fn(async () => ({
        text: "hello",
        finishReason: "stop",
        usage: {
          inputTokens: 120,
          outputTokens: 15,
          totalTokens: 135,
        },
      })),
      generateText: vi.fn(),
      generateCompletionStream: vi.fn(),
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

  it("records OSVA response cache hits without provider usage accounting", async () => {
    const runs = new MemoryRunRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const modelProfileVersionId =
      "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId;

    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-test",
        createdAt: NOW,
      }),
    );
    await seedRunningRunAndAttempt(runs, {
      modelProfileVersionBindings: { default: modelProfileVersionId },
    });

    const execution: ExecutionRequest = {
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
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
      policyContext: {
        inferenceResponseCache: {
          schemaVersion: "1",
          enabled: true,
          determinism: "REQUIRED_DETERMINISTIC",
        },
      },
    };

    const metrics = {
      modelCalls: 0,
      modelInput: 0,
    };
    const inner = {
      generateCompletionOutcome: vi.fn(),
      generateTextOutcome: vi.fn(async () => ({
        text: "cached",
        finishReason: "stop",
        invocationSource: "OSVA_RESPONSE_CACHE_HIT" as const,
      })),
      generateText: vi.fn(),
      generateCompletionStream: vi.fn(),
    } as unknown as ModelGateway;

    const recorder = createRunStepRecorder(execution, {
      runs,
      modelProfiles,
      clock: { now: () => NOW },
      ids: { createId: () => "step-cache-hit" },
      instrumentation: {
        ...NO_OP_INSTRUMENTATION,
        recordCounter: (name) => {
          if (name === OSVA_METRIC.MODEL_CALLS) {
            metrics.modelCalls += 1;
          }
          NO_OP_INSTRUMENTATION.recordCounter(name);
        },
        recordHistogram: (name) => {
          if (name === OSVA_METRIC.MODEL_INPUT_TOKENS) {
            metrics.modelInput += 1;
          }
          NO_OP_INSTRUMENTATION.recordHistogram(name, 0);
        },
      },
    });

    const wrapped = recorder.wrapModelGateway(inner);
    await wrapped.generateText({
      modelProfileVersionId,
      messages: [{ role: "user", content: "hello" }],
    });

    const steps = runs.snapshotRunSteps();
    expect(steps[0]?.modelInvocationSource).toBe("OSVA_RESPONSE_CACHE_HIT");
    expect(steps[0]?.inputTokens).toBeUndefined();
    expect(steps[0]?.estimatedCostUsdMicros).toBeNull();
    expect(metrics.modelCalls).toBe(0);
    expect(metrics.modelInput).toBe(0);
  });

  it("records a failed model step when text output is empty after provider usage", async () => {
    const runs = new MemoryRunRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const modelProfileVersionId =
      "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId;

    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-test",
        createdAt: NOW,
      }),
    );
    await seedRunningRunAndAttempt(runs, {
      modelProfileVersionBindings: { default: modelProfileVersionId },
    });

    const execution: ExecutionRequest = {
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
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
        text: "   ",
        finishReason: "stop",
        usage: {
          inputTokens: 12,
          outputTokens: 0,
          totalTokens: 12,
        },
        invocation: {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: "gpt-test-2026",
        },
        providerRequestId: "req_empty_text",
      })),
      generateCompletionOutcome: vi.fn(),
      generateText: vi.fn(),
      generateCompletionStream: vi.fn(),
    } as unknown as ModelGateway;

    const recorder = createRunStepRecorder(execution, {
      runs,
      modelProfiles,
      clock: { now: () => NOW },
      ids: { createId: () => "step-empty" },
    });

    await expect(
      recorder.wrapModelGateway(inner).generateText({
        modelProfileVersionId,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBeTruthy();

    const steps = runs.snapshotRunSteps();
    expect(steps[0]?.status).toBe("FAILED");
    expect(steps[0]?.errorCode).toBe(MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE);
    expect(steps[0]?.inputTokens).toBe(12);
    expect(steps[0]?.providerReportedModelId).toBe("gpt-test-2026");
    expect(steps[0]?.providerRequestId).toBe("req_empty_text");
  });

  it("records a succeeded model stream step once with assembled usage", async () => {
    const runs = new MemoryRunRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const modelProfileVersionId =
      "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId;

    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
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
    await seedRunningRunAndAttempt(runs, {
      modelProfileVersionBindings: { default: modelProfileVersionId },
    });

    const execution: ExecutionRequest = {
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
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

    const streamEvents = [
      {
        streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
        streamId: "s-1",
        sequence: 0,
        kind: "TEXT_DELTA" as const,
        textDelta: "hello",
      },
      {
        streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
        streamId: "s-1",
        sequence: 1,
        kind: "USAGE_FINAL" as const,
        usage: { inputUnits: 120, outputUnits: 15 },
        providerRequestId: "req-stream",
      },
      {
        streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
        streamId: "s-1",
        sequence: 2,
        kind: "COMPLETED" as const,
        finishReason: "stop" as const,
        providerRequestId: "req-stream",
      },
    ];

    const inner = {
      generateCompletionOutcome: vi.fn(),
      generateTextOutcome: vi.fn(),
      generateText: vi.fn(),
      generateCompletionStream() {
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of streamEvents) {
              yield event;
            }
          },
        };
      },
    } as unknown as ModelGateway;

    const recorder = createRunStepRecorder(execution, {
      runs,
      modelProfiles,
      clock: { now: () => NOW },
      ids: { createId: () => "step-stream" },
    });

    const wrapped = recorder.wrapModelGateway(inner);
    const collected: string[] = [];
    for await (const event of wrapped.generateCompletionStream({
      modelProfileVersionId,
      messages: [{ role: "user", content: "hello" }],
    })) {
      if (event.kind === "TEXT_DELTA") {
        collected.push(event.textDelta);
      }
    }

    expect(collected).toEqual(["hello"]);
    const steps = runs.snapshotRunSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "MODEL",
      status: "SUCCEEDED",
      inputTokens: 120,
      outputTokens: 15,
      providerRequestId: "req-stream",
    });
  });

  it("records a succeeded knowledge step without query text", async () => {
    const runs = new MemoryRunRepository();
    const knowledgeIndexBindings = {
      docs: ["idx-1" as KnowledgeIndexId],
    };
    await seedRunningRunAndAttempt(runs, { knowledgeIndexBindings });

    const execution: ExecutionRequest = {
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
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
      knowledgeIndexBindings,
      toolGrants: [],
      policyContext: {},
    };

    const inner = {
      search: vi.fn(async () => [
        {
          knowledgeChunkId:
            "chunk-1" as import("@osva-ai/contracts").KnowledgeChunkId,
          knowledgeIndexId:
            "idx-1" as import("@osva-ai/contracts").KnowledgeIndexId,
          knowledgeSourceId:
            "src-1" as import("@osva-ai/contracts").KnowledgeSourceId,
          artifactReference: {
            type: "artifact" as const,
            artifactId: "art-1" as import("@osva-ai/contracts").ArtifactId,
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
