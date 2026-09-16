import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import {
  ModelProfile,
  ModelProfileVersion,
  type ModelProfileRepository,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { ModelGateway } from "../src/model-gateway.js";
import { ModelGatewayError } from "../src/errors.js";
import type {
  ModelProviderAdapter,
  ResolvedProviderGenerateTextRequest,
} from "../src/provider-adapter.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const profileId = "mp-1" as ModelProfileId;
const versionId = "mpv-1" as ModelProfileVersionId;

async function seedOpenAIVersion(
  repository: ModelProfileRepository,
  model = "gpt-test-snapshot",
): Promise<void> {
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
      model,
      createdAt: NOW,
    }),
  );
}

describe("ModelGateway", () => {
  it("loads ModelProfileVersion and routes OPENAI to the provider adapter", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedOpenAIVersion(modelProfiles);
    const seen: ResolvedProviderGenerateTextRequest[] = [];
    const openai: ModelProviderAdapter = {
      async generateText(request) {
        seen.push(request);
        return { text: "adapter output" };
      },
    };

    const gateway = new ModelGateway({
      modelProfiles,
      providers: { OPENAI: openai },
    });

    const result = await gateway.generateText({
      modelProfileVersionId: versionId,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      maxOutputTokens: 32,
    });

    expect(result).toEqual({ text: "adapter output" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.model).toBe("gpt-test-snapshot");
    expect(seen[0]?.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hello" },
    ]);
    expect(JSON.stringify(seen[0])).not.toContain("OpenAI");
    expect(seen[0]).not.toHaveProperty("client");
  });

  it("forwards internal AbortSignal cancellation to the provider adapter", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedOpenAIVersion(modelProfiles);
    const controller = new AbortController();
    const seen: ResolvedProviderGenerateTextRequest[] = [];
    const openai: ModelProviderAdapter = {
      async generateText(request) {
        seen.push(request);
        return { text: "adapter output" };
      },
    };

    const gateway = new ModelGateway({
      modelProfiles,
      providers: { OPENAI: openai },
    });

    await gateway.generateText(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "Hello" }],
      },
      { signal: controller.signal },
    );

    expect(seen[0]?.signal).toBe(controller.signal);
    expect(JSON.stringify({ ...seen[0], signal: undefined })).not.toContain(
      "AbortSignal",
    );
  });

  it("returns MODEL_PROFILE_VERSION_NOT_FOUND for an unknown version", async () => {
    const gateway = new ModelGateway({
      modelProfiles: new MemoryModelProfileRepository(),
      providers: {},
    });

    await expect(
      gateway.generateText({
        modelProfileVersionId: "missing" as ModelProfileVersionId,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
    });
  });

  it("returns MODEL_PROVIDER_UNAVAILABLE when OPENAI is not configured", async () => {
    const modelProfiles = new MemoryModelProfileRepository();
    await seedOpenAIVersion(modelProfiles);
    const gateway = new ModelGateway({
      modelProfiles,
      providers: {},
    });

    await expect(
      gateway.generateText({
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toBeInstanceOf(ModelGatewayError);

    await expect(
      gateway.generateText({
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
    });
  });
});
