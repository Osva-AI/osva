import { Agent, AgentVersion, DomainInvariantError } from "@osva/domain";
import type { AgentRepository } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepository } from "../src/memory-agent-repository.js";
import {
  agentId,
  agentVersionId,
  createManifest,
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
});
