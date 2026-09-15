import type { AgentId } from "@osva/contracts";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DuplicateAgentKeyError,
  Workspace,
  WorkspaceNotFoundError,
  createAgentApplication,
  type AgentApplication,
  type AgentRepository,
  type WorkspaceRepository,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepository } from "../src/memory-agent-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, createManifest, workspaceId } from "./fixtures.js";

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
});

function createEmptyHarness(): {
  application: AgentApplication;
  agents: AgentRepository;
  workspaces: WorkspaceRepository;
} {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  let counter = 0;

  return {
    agents,
    workspaces,
    application: createAgentApplication({
      agents,
      workspaces,
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
