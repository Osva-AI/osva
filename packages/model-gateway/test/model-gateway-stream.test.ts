import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelStreamEvent,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  assembleModelStreamCompletion,
  MODEL_ERROR_CODES,
} from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile, ModelProfileVersion } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CachingModelGateway } from "../src/caching-model-gateway.js";
import { ModelGateway } from "../src/model-gateway.js";
import type {
  ModelProviderAdapter,
  ResolvedProviderGenerateTextRequest,
} from "../src/provider-adapter.js";
import { collectModelStreamEvents } from "./model-stream-test-helpers.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const profileId = "mp-stream" as ModelProfileId;
const versionId = "mpv-stream" as ModelProfileVersionId;

async function seedVersion(repository: MemoryModelProfileRepository) {
  await repository.saveModelProfile(
    ModelProfile.create({
      id: profileId,
      workspaceId: "ws-1" as WorkspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    }),
  );
  await repository.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: versionId,
      modelProfileId: profileId,
      version: 1,
      provider: "OPENAI",
      model: "gpt-test",
      createdAt: NOW,
    }),
  );
}

function fakeStreamProvider(
  implementation?: (
    request: ResolvedProviderGenerateTextRequest,
  ) => ModelStreamEvent[],
): ModelProviderAdapter {
  return {
    async generateText() {
      return { text: "sync" };
    },
    generateCompletionStream(request) {
      const events = implementation?.(request) ?? [
        {
          streamFormatVersion: "1",
          streamId: "gw-test",
          sequence: 0,
          kind: "TEXT_DELTA",
          textDelta: "streamed ",
        },
        {
          streamFormatVersion: "1",
          streamId: "gw-test",
          sequence: 1,
          kind: "TEXT_DELTA",
          textDelta: "text",
        },
        {
          streamFormatVersion: "1",
          streamId: "gw-test",
          sequence: 2,
          kind: "COMPLETED",
          finishReason: "stop",
        },
      ];
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };
    },
  };
}

describe("ModelGateway.generateCompletionStream", () => {
  it("routes through model profile version and assembles", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedVersion(modelProfiles);
    const seen: ResolvedProviderGenerateTextRequest[] = [];

    const base = fakeStreamProvider();
    const gateway = new ModelGateway({
      modelProfiles,
      providers: {
        OPENAI: {
          generateText: base.generateText.bind(base),
          generateCompletionStream(request) {
            seen.push(request);
            return base.generateCompletionStream!(request);
          },
        },
      },
    });

    const events = await collectModelStreamEvents(
      gateway.generateCompletionStream({
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "Hello" }],
      }),
    );

    expect(seen[0]?.model).toBe("gpt-test");
    const assembled = assembleModelStreamCompletion(events);
    expect(assembled.ok).toBe(true);
    if (assembled.ok) {
      expect(assembled.result.text).toBe("streamed text");
    }
  });

  it("propagates AbortSignal and emits cancelled terminal", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedVersion(modelProfiles);
    const controller = new AbortController();
    controller.abort();

    const gateway = new ModelGateway({
      modelProfiles,
      providers: { OPENAI: fakeStreamProvider() },
    });

    const events = await collectModelStreamEvents(
      gateway.generateCompletionStream(
        {
          modelProfileVersionId: versionId,
          messages: [{ role: "user", content: "Hello" }],
        },
        { signal: controller.signal },
      ),
    );

    expect(events.at(-1)?.kind).toBe("CANCELLED");
  });

  it("CachingModelGateway bypasses exact-response cache for streaming", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedVersion(modelProfiles);
    const provider = fakeStreamProvider();
    const inner = new ModelGateway({
      modelProfiles,
      providers: { OPENAI: provider },
    });
    const cache = new CachingModelGateway({
      inner,
      modelProfiles,
      cache: {
        async lookup() {
          throw new Error("cache lookup should not run for stream");
        },
        async putIfAbsent() {
          throw new Error("cache put should not run for stream");
        },
      },
    });

    await collectModelStreamEvents(
      cache.generateCompletionStream({
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "Hello" }],
      }),
    );
  });

  it("reports unavailable when adapter lacks streaming", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedVersion(modelProfiles);
    const gateway = new ModelGateway({
      modelProfiles,
      providers: {
        OPENAI: {
          async generateText() {
            return { text: "sync only" };
          },
        },
      },
    });

    await expect(
      collectModelStreamEvents(
        gateway.generateCompletionStream({
          modelProfileVersionId: versionId,
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
    });
  });
});
