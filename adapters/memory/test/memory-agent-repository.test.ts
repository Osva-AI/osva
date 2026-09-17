import {
  Agent,
  AgentNotFoundError,
  AgentVersion,
  DomainInvariantError,
} from "@osva/domain";
import type { AgentRepository } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepository } from "../src/memory-agent-repository.js";
import {
  agentId,
  agentVersionId,
  createManifest,
  LATER,
  NOW,
  otherAgentId,
  otherAgentVersionId,
  otherWorkspaceId,
  workspaceId,
} from "./fixtures.js";

describe("MemoryAgentRepository", () => {
  it("saves and finds an Agent through the port", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    const agent = Agent.create({
      id: agentId,
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
      createdAt: NOW,
    });

    await repository.saveAgent(agent);

    await expect(repository.findAgentById(agentId)).resolves.toBe(agent);
  });

  it("saves and finds an AgentVersion through the port", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    const version = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    await repository.saveAgentVersion(version);

    await expect(repository.findAgentVersionById(agentVersionId)).resolves.toBe(
      version,
    );
  });

  it("persists immutable remote HTTP runtime configuration", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    const runtime = {
      type: "REMOTE_HTTP" as const,
      protocolVersion: "1" as const,
      endpoint: "https://runtime.example.com/execute",
      authSecretRef: { key: "OSVA_REMOTE_RUNTIME_TOKEN" },
      timeoutMs: 15_000,
    };
    const version = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest({ runtime }),
      createdAt: NOW,
    });

    await repository.saveAgentVersion(version);
    const loaded = await repository.findAgentVersionById(agentVersionId);
    expect(loaded?.manifest.runtime).toEqual(runtime);
  });

  it("treats saving the same immutable AgentVersion as idempotent", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    const first = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });
    const equivalent = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    await repository.saveAgentVersion(first);
    await repository.saveAgentVersion(first);
    await repository.saveAgentVersion(equivalent);

    await expect(repository.findAgentVersionById(agentVersionId)).resolves.toBe(
      first,
    );
  });

  it("rejects replacing an AgentVersion with different content", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    await repository.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );

    await expect(
      repository.saveAgentVersion(
        AgentVersion.create({
          id: agentVersionId,
          agentId,
          version: 1,
          manifest: createManifest({ name: "Changed Agent" }),
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(DomainInvariantError);

    const stored = await repository.findAgentVersionById(agentVersionId);
    expect(stored?.manifest.name).toBe("Example Agent");
  });

  it("rejects a duplicate workspace/key pair", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    await repository.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );

    await expect(
      repository.saveAgent(
        Agent.create({
          id: otherAgentId,
          workspaceId,
          key: "example-agent",
          name: "Other Agent",
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(DomainInvariantError);
  });

  it("allows the same Agent key in a different workspace", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    await repository.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );

    const other = Agent.create({
      id: otherAgentId,
      workspaceId: otherWorkspaceId,
      key: "example-agent",
      name: "Other Workspace Agent",
      createdAt: NOW,
    });
    await repository.saveAgent(other);

    await expect(repository.findAgentById(otherAgentId)).resolves.toBe(other);
  });

  it("rejects a second AgentVersion with the same agentId and version", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    await repository.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );

    await expect(
      repository.saveAgentVersion(
        AgentVersion.create({
          id: otherAgentVersionId,
          agentId,
          version: 1,
          manifest: createManifest({ name: "Other Snapshot" }),
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(DomainInvariantError);

    const stored = await repository.findAgentVersionById(agentVersionId);
    expect(stored?.manifest.name).toBe("Example Agent");
    await expect(
      repository.findAgentVersionById(otherAgentVersionId),
    ).resolves.toBeNull();
  });

  it("lists Agents in createdAt then id order and updates name only", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    const first = Agent.create({
      id: agentId,
      workspaceId,
      key: "first-agent",
      name: "First Agent",
      createdAt: NOW,
    });
    const second = Agent.create({
      id: otherAgentId,
      workspaceId,
      key: "second-agent",
      name: "Second Agent",
      createdAt: LATER,
    });

    await repository.saveAgent(first);
    await repository.saveAgent(second);

    const updated = await repository.updateAgentMetadata(agentId, {
      name: "Renamed First",
    });

    expect(updated?.name).toBe("Renamed First");
    expect(updated?.key).toBe("first-agent");
    expect(updated?.createdAt).toEqual(NOW);
    expect(
      await repository
        .listAgents()
        .then((agents) => agents.map((agent) => agent.id)),
    ).toEqual([agentId, otherAgentId]);
    expect(repository).not.toHaveProperty("updateAgentVersion");
  });

  it("appends versions with per-Agent numbers and lists them in version order", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();
    await repository.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await repository.saveAgent(
      Agent.create({
        id: otherAgentId,
        workspaceId,
        key: "other-agent",
        name: "Other Agent",
        createdAt: NOW,
      }),
    );

    const first = await repository.appendAgentVersion({
      id: agentVersionId,
      agentId,
      manifest: createManifest(),
      createdAt: NOW,
    });
    const second = await repository.appendAgentVersion({
      id: otherAgentVersionId,
      agentId,
      manifest: createManifest({ name: "Second Snapshot" }),
      createdAt: LATER,
    });
    const otherFirst = await repository.appendAgentVersion({
      id: "agent-version-other-1" as typeof otherAgentVersionId,
      agentId: otherAgentId,
      manifest: createManifest({ name: "Other First" }),
      createdAt: NOW,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(otherFirst.version).toBe(1);
    expect(
      (await repository.listAgentVersions(agentId)).map(
        (version) => version.version,
      ),
    ).toEqual([1, 2]);
  });

  it("rejects appending a version for a nonexistent Agent", async () => {
    const repository: AgentRepository = new MemoryAgentRepository();

    await expect(
      repository.appendAgentVersion({
        id: agentVersionId,
        agentId,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});
