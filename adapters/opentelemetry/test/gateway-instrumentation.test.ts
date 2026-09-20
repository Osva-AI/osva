import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionRequest,
  GenerateTextRequest,
  MemoryAuthorization,
  MemoryGetRequest,
  AgentId,
  ModelProfileId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  ToolInvokeRequest,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";
import type { MemoryGateway } from "@osva/contracts";
import {
  MemoryModelProfileRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import { ModelProfile, ModelProfileVersion } from "@osva/domain";
import type { ModelGateway } from "@osva/model-gateway";
import type { ToolGateway } from "@osva/tool-gateway";
import { OSVA_SPAN, createRunStepRecorder } from "@osva/observability";

import { createInMemoryOpenTelemetryHarness } from "../src/testing/index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const MODEL_PROFILE_VERSION_ID = "mpv-1" as ModelProfileVersionId;

const EXECUTION = {
  runId: "run-1" as RunId,
  runAttemptId: "attempt-1" as RunAttemptId,
  agentVersionId: "av-1",
  workspaceId: "ws-1" as WorkspaceId,
  agentId: "agent-1",
  executionId: "attempt-1" as RunAttemptId,
  timeoutMs: 30_000,
  input: {},
  effectiveConfig: {},
  runtime: {
    type: "TRUSTED_TYPESCRIPT" as const,
    entrypoint: "agent.ts",
    integrity: "sha256:00",
  },
  modelProfileVersionBindings: { default: MODEL_PROFILE_VERSION_ID },
  toolVersionBindings: {},
  memoryNamespaceBindings: {},
  knowledgeIndexBindings: {},
  toolGrants: [],
  policyContext: {},
} as unknown as ExecutionRequest;

async function createRecorderDeps(
  instrumentation: Awaited<
    ReturnType<typeof createInMemoryOpenTelemetryHarness>
  >["instrumentation"],
) {
  const runs = new MemoryRunRepository();
  const modelProfiles = new MemoryModelProfileRepository();
  await modelProfiles.saveModelProfile(
    ModelProfile.create({
      id: "mp-1" as ModelProfileId,
      workspaceId: "ws-1" as WorkspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    }),
  );
  await modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: MODEL_PROFILE_VERSION_ID,
      modelProfileId: "mp-1" as ModelProfileId,
      version: 1,
      provider: "OPENAI",
      model: "gpt-test",
      createdAt: NOW,
    }),
  );

  return {
    runs,
    modelProfiles,
    clock: { now: () => NOW },
    ids: { createId: () => "step-1" },
    instrumentation,
  };
}

describe("gateway instrumentation privacy", () => {
  it("records model metadata without prompt or output content", async () => {
    const harness = await createInMemoryOpenTelemetryHarness();
    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "secret-output",
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      })),
      generateText: vi.fn(),
    } as unknown as ModelGateway;

    try {
      const recorder = createRunStepRecorder(
        EXECUTION,
        await createRecorderDeps(harness.instrumentation),
      );
      await recorder.wrapModelGateway(inner).generateText({
        modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
        messages: [{ role: "user", content: "secret prompt" }],
      } satisfies GenerateTextRequest);

      const span = harness.spanExporter
        .getFinishedSpans()
        .find((candidate) => candidate.name === OSVA_SPAN.MODEL_GENERATE_TEXT);
      const keys = Object.keys(span?.attributes ?? {});
      expect(keys).not.toContain("prompt");
      expect(keys).not.toContain("messages");
    } finally {
      await harness.shutdown();
    }
  });

  it("records tool metadata without argument or result payloads", async () => {
    const harness = await createInMemoryOpenTelemetryHarness();
    const inner = {
      invoke: vi.fn(async () => ({ secret: "result" })),
    } as unknown as ToolGateway;

    try {
      const recorder = createRunStepRecorder(
        EXECUTION,
        await createRecorderDeps(harness.instrumentation),
      );
      await recorder.wrapToolGateway(inner).invoke({
        toolVersionId: "tv-1" as ToolVersionId,
        input: { secret: "args" },
        authorization: {
          bindingName: "tool",
          runId: "run-1" as RunId,
          runAttemptId: "attempt-1" as RunAttemptId,
          workspaceId: "ws-1" as WorkspaceId,
          agentId: "agent-1" as AgentId,
          toolVersionId: "tv-1" as ToolVersionId,
        },
      } satisfies ToolInvokeRequest);

      const span = harness.spanExporter
        .getFinishedSpans()
        .find((candidate) => candidate.name === OSVA_SPAN.TOOL_INVOKE);
      const keys = Object.keys(span?.attributes ?? {});
      expect(keys).not.toContain("input");
      expect(keys).not.toContain("output");
    } finally {
      await harness.shutdown();
    }
  });

  it("records memory operation metadata without key or value payloads", async () => {
    const harness = await createInMemoryOpenTelemetryHarness();
    const inner = {
      get: vi.fn(async () => ({
        key: "secret-key",
        value: { secret: "value" },
        revision: 1,
      })),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as MemoryGateway;

    try {
      const recorder = createRunStepRecorder(
        EXECUTION,
        await createRecorderDeps(harness.instrumentation),
      );
      await recorder.wrapMemoryGateway(inner).get(
        {
          bindingName: "store",
          key: "secret-key",
        } satisfies MemoryGetRequest,
        {
          workspaceId: "ws-1",
          memoryNamespaceBindings: {
            store: {
              namespaceId: "mn-1",
              access: "READ",
            },
          },
          allowPersistentMutation: false,
        } as unknown as MemoryAuthorization,
      );

      const span = harness.spanExporter
        .getFinishedSpans()
        .find((candidate) => candidate.name === OSVA_SPAN.MEMORY_OPERATION);
      const keys = Object.keys(span?.attributes ?? {});
      expect(keys).not.toContain("key");
      expect(keys).not.toContain("value");
    } finally {
      await harness.shutdown();
    }
  });
});
