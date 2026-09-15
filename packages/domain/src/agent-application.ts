import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  WorkspaceId,
} from "@osva/contracts";

import { Agent } from "./agent.js";
import type { AgentVersion } from "./agent-version.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  InvalidModelBindingError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { modelProfileVersionBindingsFromManifest } from "./model-bindings.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

export interface AgentApplicationClock {
  now(): Date;
}

export interface AgentApplicationIds {
  createId(): string;
}

export interface AgentApplicationDependencies {
  readonly agents: AgentRepository;
  readonly workspaces: WorkspaceRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly clock: AgentApplicationClock;
  readonly ids: AgentApplicationIds;
}

export interface CreateAgentCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateAgentMetadataCommand {
  readonly agentId: AgentId;
  readonly name: string;
}

export interface AppendAgentVersionCommand {
  readonly agentId: AgentId;
  readonly manifest: AgentManifestV1;
}

export interface GetAgentVersionCommand {
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
}

export class CreateAgent {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(command: CreateAgentCommand): Promise<Agent> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const agent = Agent.create({
      id: this.deps.ids.createId() as AgentId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.agents.saveAgent(agent);
    return agent;
  }
}

export class GetAgent {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(agentId: AgentId): Promise<Agent> {
    const agent = await this.deps.agents.findAgentById(agentId);
    if (agent === null) {
      throw new AgentNotFoundError(agentId);
    }

    return agent;
  }
}

export class ListAgents {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(): Promise<Agent[]> {
    return this.deps.agents.listAgents();
  }
}

export class UpdateAgentMetadata {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(command: UpdateAgentMetadataCommand): Promise<Agent> {
    const updated = await this.deps.agents.updateAgentMetadata(
      command.agentId,
      {
        name: command.name,
      },
    );
    if (updated === null) {
      throw new AgentNotFoundError(command.agentId);
    }

    return updated;
  }
}

export class AppendAgentVersion {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(command: AppendAgentVersionCommand): Promise<AgentVersion> {
    const agent = await this.deps.agents.findAgentById(command.agentId);
    if (agent === null) {
      throw new AgentNotFoundError(command.agentId);
    }

    await assertModelBindings(
      this.deps.modelProfiles,
      agent.workspaceId,
      command.manifest,
    );

    return this.deps.agents.appendAgentVersion({
      id: this.deps.ids.createId() as AgentVersionId,
      agentId: command.agentId,
      manifest: command.manifest,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetAgentVersion {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(command: GetAgentVersionCommand): Promise<AgentVersion> {
    const agent = await this.deps.agents.findAgentById(command.agentId);
    if (agent === null) {
      throw new AgentNotFoundError(command.agentId);
    }

    const version = await this.deps.agents.findAgentVersionById(
      command.agentVersionId,
    );
    if (version === null || version.agentId !== command.agentId) {
      throw new AgentVersionNotFoundError(command.agentVersionId);
    }

    return version;
  }
}

export class ListAgentVersions {
  constructor(private readonly deps: AgentApplicationDependencies) {}

  async execute(agentId: AgentId): Promise<AgentVersion[]> {
    const agent = await this.deps.agents.findAgentById(agentId);
    if (agent === null) {
      throw new AgentNotFoundError(agentId);
    }

    return this.deps.agents.listAgentVersions(agentId);
  }
}

export interface AgentApplication {
  readonly createAgent: CreateAgent;
  readonly getAgent: GetAgent;
  readonly listAgents: ListAgents;
  readonly updateAgentMetadata: UpdateAgentMetadata;
  readonly appendAgentVersion: AppendAgentVersion;
  readonly getAgentVersion: GetAgentVersion;
  readonly listAgentVersions: ListAgentVersions;
}

export function createAgentApplication(
  deps: AgentApplicationDependencies,
): AgentApplication {
  return {
    createAgent: new CreateAgent(deps),
    getAgent: new GetAgent(deps),
    listAgents: new ListAgents(deps),
    updateAgentMetadata: new UpdateAgentMetadata(deps),
    appendAgentVersion: new AppendAgentVersion(deps),
    getAgentVersion: new GetAgentVersion(deps),
    listAgentVersions: new ListAgentVersions(deps),
  };
}

async function assertModelBindings(
  modelProfiles: ModelProfileRepository,
  workspaceId: WorkspaceId,
  manifest: AgentManifestV1,
): Promise<void> {
  const bindings = modelProfileVersionBindingsFromManifest(manifest);
  for (const [name, modelProfileVersionId] of Object.entries(bindings)) {
    const version = await modelProfiles.findModelProfileVersionById(
      modelProfileVersionId,
    );
    if (version === null) {
      throw new InvalidModelBindingError(
        `Model binding '${name}' references unknown ModelProfileVersion '${modelProfileVersionId}'.`,
      );
    }

    const profile = await modelProfiles.findModelProfileById(
      version.modelProfileId,
    );
    if (profile === null || profile.workspaceId !== workspaceId) {
      throw new InvalidModelBindingError(
        `Model binding '${name}' does not belong to workspace '${workspaceId}'.`,
      );
    }
  }
}
