import type { AgentId, ModelProfileVersionId } from "@osva/contracts";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DuplicateAgentKeyError,
  InvalidModelBindingError,
  Workspace,
  WorkspaceNotFoundError,
  createAgentApplication,
  createModelProfileApplication,
  type AgentApplication,
  type AgentRepository,
  type WorkspaceRepository,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepository } from "../src/memory-agent-repository.js";
import { MemoryModelProfileRepository } from "../src/memory-model-profile-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import {
  NOW,
  createManifest,
  otherWorkspaceId,
  workspaceId,
} from "./fixtures.js";

describe("Agent Registry application", () => {
  it("creates, reads, lists, and updates Agents", async () => {
    const { application } = await createHarness();

    const created = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });
    const loaded = await application.getAgent.execute(created.id);
    const listed = await application.listAgents.execute();
    const renamed = await application.updateAgentMetadata.execute({
      agentId: created.id,
      name: "Renamed Agent",
    });

    expect(created.createdAt).toEqual(NOW);
    expect(loaded.id).toBe(created.id);
    expect(loaded.name).toBe("Example Agent");
    expect(listed).toHaveLength(1);
    expect(renamed.name).toBe("Renamed Agent");
    expect(renamed.key).toBe("example-agent");
    expect(renamed.workspaceId).toBe(workspaceId);
  });

  it("rejects unknown Agent lookups and metadata updates", async () => {
    const { application } = await createHarness();

    await expect(
      application.getAgent.execute("missing-agent" as AgentId),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      application.updateAgentMetadata.execute({
        agentId: "missing-agent" as AgentId,
        name: "Nope",
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("rejects creating an Agent in a missing Workspace", async () => {
    const { application } = createEmptyHarness();

    await expect(
      application.createAgent.execute({
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
      }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("rejects a duplicate Agent key in the same Workspace", async () => {
    const { application } = await createHarness();

    await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });

    await expect(
      application.createAgent.execute({
        workspaceId,
        key: "example-agent",
        name: "Other Agent",
      }),
    ).rejects.toBeInstanceOf(DuplicateAgentKeyError);
  });

  it("appends immutable AgentVersions with per-Agent numbering", async () => {
    const { application } = await createHarness();

    const firstAgent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });
    const secondAgent = await application.createAgent.execute({
      workspaceId,
      key: "other-agent",
      name: "Other Agent",
    });

    const v1 = await application.appendAgentVersion.execute({
      agentId: firstAgent.id,
      manifest: createManifest(),
    });
    const v2 = await application.appendAgentVersion.execute({
      agentId: firstAgent.id,
      manifest: createManifest({ name: "Second Snapshot" }),
    });
    const otherV1 = await application.appendAgentVersion.execute({
      agentId: secondAgent.id,
      manifest: createManifest({ name: "Other First" }),
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(otherV1.version).toBe(1);

    const listed = await application.listAgentVersions.execute(firstAgent.id);
    expect(listed.map((version) => version.version)).toEqual([1, 2]);

    const loaded = await application.getAgentVersion.execute({
      agentId: firstAgent.id,
      agentVersionId: v2.id,
    });
    expect(loaded.manifest.name).toBe("Second Snapshot");
  });

  it("rejects creating a version for a nonexistent Agent", async () => {
    const { application } = await createHarness();

    await expect(
      application.appendAgentVersion.execute({
        agentId: "missing-agent" as AgentId,
        manifest: createManifest(),
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("enforces nested AgentVersion ownership", async () => {
    const { application } = await createHarness();

    const firstAgent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });
    const secondAgent = await application.createAgent.execute({
      workspaceId,
      key: "other-agent",
      name: "Other Agent",
    });
    const version = await application.appendAgentVersion.execute({
      agentId: firstAgent.id,
      manifest: createManifest(),
    });

    await expect(
      application.getAgentVersion.execute({
        agentId: secondAgent.id,
        agentVersionId: version.id,
      }),
    ).rejects.toBeInstanceOf(AgentVersionNotFoundError);
  });

  it("does not mutate an existing AgentVersion through application commands", async () => {
    const { application } = createEmptyHarness();

    expect(application).not.toHaveProperty("updateAgentVersion");
    expect(application.appendAgentVersion).not.toHaveProperty(
      "updateAgentVersion",
    );
  });

  it("accepts an AgentVersion with a same-workspace model binding", async () => {
    const { application, modelProfiles, workspaces } = await createHarness();
    const agent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });
    let profileIds = 0;
    const profiles = createModelProfileApplication({
      modelProfiles,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          profileIds += 1;
          return `mp-${String(profileIds)}`;
        },
      },
    });
    const profile = await profiles.createModelProfile.execute({
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const version = await profiles.appendModelProfileVersion.execute({
      modelProfileId: profile.id,
      provider: "OPENAI",
      model: "gpt-test-snapshot",
    });

    const agentVersion = await application.appendAgentVersion.execute({
      agentId: agent.id,
      manifest: createManifest({
        models: {
          primary: { modelProfileVersionId: version.id },
        },
      }),
    });

    expect(agentVersion.manifest.models).toEqual({
      primary: { modelProfileVersionId: version.id },
    });
  });

  it("rejects a missing ModelProfileVersion binding", async () => {
    const { application } = await createHarness();
    const agent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });

    await expect(
      application.appendAgentVersion.execute({
        agentId: agent.id,
        manifest: createManifest({
          models: {
            primary: {
              modelProfileVersionId: "missing-mpv" as ModelProfileVersionId,
            },
          },
        }),
      }),
    ).rejects.toBeInstanceOf(InvalidModelBindingError);
  });

  it("rejects a cross-workspace model binding", async () => {
    const { application, modelProfiles, workspaces } = await createHarness();
    await workspaces.save(
      Workspace.create({
        id: otherWorkspaceId,
        name: "Other",
        createdAt: NOW,
      }),
    );
    let otherIds = 0;
    const profiles = createModelProfileApplication({
      modelProfiles,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          otherIds += 1;
          return `other-${String(otherIds)}`;
        },
      },
    });
    const otherProfile = await profiles.createModelProfile.execute({
      workspaceId: otherWorkspaceId,
      key: "primary",
      name: "Other Primary",
    });
    const otherVersion = await profiles.appendModelProfileVersion.execute({
      modelProfileId: otherProfile.id,
      provider: "OPENAI",
      model: "gpt-other",
    });
    const agent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });

    await expect(
      application.appendAgentVersion.execute({
        agentId: agent.id,
        manifest: createManifest({
          models: {
            primary: { modelProfileVersionId: otherVersion.id },
          },
        }),
      }),
    ).rejects.toBeInstanceOf(InvalidModelBindingError);
  });

  it("accepts an AgentVersion without model bindings", async () => {
    const { application } = await createHarness();
    const agent = await application.createAgent.execute({
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
    });
    const version = await application.appendAgentVersion.execute({
      agentId: agent.id,
      manifest: createManifest(),
    });
    expect(version.manifest.models).toBeUndefined();
  });
});

function createEmptyHarness(): {
  application: AgentApplication;
  agents: AgentRepository;
  workspaces: WorkspaceRepository;
  modelProfiles: MemoryModelProfileRepository;
} {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const modelProfiles = new MemoryModelProfileRepository();
  let counter = 0;

  return {
    agents,
    workspaces,
    modelProfiles,
    application: createAgentApplication({
      agents,
      workspaces,
      modelProfiles,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `generated-${String(counter)}`;
        },
      },
    }),
  };
}

async function createHarness() {
  const harness = createEmptyHarness();
  await harness.workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  return harness;
}
