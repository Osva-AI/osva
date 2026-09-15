import type { ModelProfileId, ModelProfileVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateModelProfileKeyError,
  ModelProfile,
  ModelProfileNotFoundError,
  ModelProfileVersion,
  ModelProfileVersionNotFoundError,
  Workspace,
  createModelProfileApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryModelProfileRepository } from "../src/memory-model-profile-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, workspaceId } from "./fixtures.js";

describe("MemoryModelProfileRepository", () => {
  it("creates, reads, lists, and renames ModelProfiles", async () => {
    const { application } = await createHarness();
    const created = await application.createModelProfile.execute({
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const loaded = await application.getModelProfile.execute(created.id);
    const listed = await application.listModelProfiles.execute();
    const renamed = await application.updateModelProfileMetadata.execute({
      modelProfileId: created.id,
      name: "Renamed",
    });

    expect(loaded.name).toBe("Primary");
    expect(listed).toHaveLength(1);
    expect(renamed.name).toBe("Renamed");
    expect(renamed.key).toBe("primary");
    expect(renamed.workspaceId).toBe(workspaceId);
  });

  it("rejects an unknown ModelProfile", async () => {
    const { application } = await createHarness();
    await expect(
      application.getModelProfile.execute("missing" as ModelProfileId),
    ).rejects.toBeInstanceOf(ModelProfileNotFoundError);
  });

  it("appends immutable ModelProfileVersions with per-profile numbering", async () => {
    const { application } = await createHarness();
    const first = await application.createModelProfile.execute({
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const second = await application.createModelProfile.execute({
      workspaceId,
      key: "secondary",
      name: "Secondary",
    });
    const v1 = await application.appendModelProfileVersion.execute({
      modelProfileId: first.id,
      provider: "OPENAI",
      model: "gpt-one",
    });
    const v2 = await application.appendModelProfileVersion.execute({
      modelProfileId: first.id,
      provider: "OPENAI",
      model: "gpt-two",
    });
    const otherV1 = await application.appendModelProfileVersion.execute({
      modelProfileId: second.id,
      provider: "OPENAI",
      model: "gpt-other",
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(otherV1.version).toBe(1);
    expect(v1).not.toHaveProperty("apiKey");
    expect(v1).not.toHaveProperty("credentials");
    expect(JSON.stringify(v1)).not.toContain("sk-");
  });

  it("enforces nested ModelProfileVersion ownership", async () => {
    const { application } = await createHarness();
    const first = await application.createModelProfile.execute({
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const second = await application.createModelProfile.execute({
      workspaceId,
      key: "secondary",
      name: "Secondary",
    });
    const version = await application.appendModelProfileVersion.execute({
      modelProfileId: first.id,
      provider: "OPENAI",
      model: "gpt-one",
    });

    await expect(
      application.getModelProfileVersion.execute({
        modelProfileId: second.id,
        modelProfileVersionId: version.id,
      }),
    ).rejects.toBeInstanceOf(ModelProfileVersionNotFoundError);
  });

  it("has no ModelProfileVersion update operation", async () => {
    const { application, repository } = await createHarness();
    expect(application).not.toHaveProperty("updateModelProfileVersion");
    expect(repository).not.toHaveProperty("updateModelProfileVersion");
  });

  it("rejects replacing an immutable ModelProfileVersion", async () => {
    const repository = new MemoryModelProfileRepository();
    const profile = ModelProfile.create({
      id: "mp-1" as ModelProfileId,
      workspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    });
    await repository.saveModelProfile(profile);
    const version = ModelProfileVersion.create({
      id: "mpv-1" as ModelProfileVersionId,
      modelProfileId: profile.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-one",
      createdAt: NOW,
    });
    await repository.saveModelProfileVersion(version);
    await expect(
      repository.saveModelProfileVersion(
        ModelProfileVersion.create({
          id: version.id,
          modelProfileId: profile.id,
          version: 1,
          provider: "OPENAI",
          model: "gpt-two",
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("rejects a duplicate ModelProfile key", async () => {
    const { application } = await createHarness();
    await application.createModelProfile.execute({
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    await expect(
      application.createModelProfile.execute({
        workspaceId,
        key: "primary",
        name: "Other",
      }),
    ).rejects.toBeInstanceOf(DuplicateModelProfileKeyError);
  });

  it("rejects appending a version to a missing ModelProfile", async () => {
    const { application } = await createHarness();
    await expect(
      application.appendModelProfileVersion.execute({
        modelProfileId: "missing" as ModelProfileId,
        provider: "OPENAI",
        model: "gpt-one",
      }),
    ).rejects.toBeInstanceOf(ModelProfileNotFoundError);
  });
});

async function createHarness() {
  const workspaces = new MemoryWorkspaceRepository();
  const repository = new MemoryModelProfileRepository();
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  let counter = 0;
  return {
    repository,
    application: createModelProfileApplication({
      modelProfiles: repository,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `mp-${String(counter)}`;
        },
      },
    }),
  };
}
