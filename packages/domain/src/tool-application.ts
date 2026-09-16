import type {
  InternalToolImplementationId,
  ToolId,
  ToolType,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";

import {
  ToolNotFoundError,
  ToolVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { Tool } from "./tool.js";
import type { ToolVersion } from "./tool-version.js";
import type { ToolRepository } from "./ports/tool-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

export interface ToolApplicationClock {
  now(): Date;
}

export interface ToolApplicationIds {
  createId(): string;
}

export interface ToolApplicationDependencies {
  readonly tools: ToolRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: ToolApplicationClock;
  readonly ids: ToolApplicationIds;
}

export interface CreateToolCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateToolMetadataCommand {
  readonly toolId: ToolId;
  readonly name: string;
}

export interface AppendToolVersionCommand {
  readonly toolId: ToolId;
  readonly type: ToolType;
  readonly implementation: InternalToolImplementationId;
}

export interface GetToolVersionCommand {
  readonly toolId: ToolId;
  readonly toolVersionId: ToolVersionId;
}

export class CreateTool {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(command: CreateToolCommand): Promise<Tool> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const tool = Tool.create({
      id: this.deps.ids.createId() as ToolId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.tools.saveTool(tool);
    return tool;
  }
}

export class GetTool {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(toolId: ToolId): Promise<Tool> {
    const tool = await this.deps.tools.findToolById(toolId);
    if (tool === null) {
      throw new ToolNotFoundError(toolId);
    }

    return tool;
  }
}

export class ListTools {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(): Promise<Tool[]> {
    return this.deps.tools.listTools();
  }
}

export class UpdateToolMetadata {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(command: UpdateToolMetadataCommand): Promise<Tool> {
    const updated = await this.deps.tools.updateToolMetadata(command.toolId, {
      name: command.name,
    });
    if (updated === null) {
      throw new ToolNotFoundError(command.toolId);
    }

    return updated;
  }
}

export class AppendToolVersion {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(command: AppendToolVersionCommand): Promise<ToolVersion> {
    return this.deps.tools.appendToolVersion({
      id: this.deps.ids.createId() as ToolVersionId,
      toolId: command.toolId,
      type: command.type,
      implementation: command.implementation,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetToolVersion {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(command: GetToolVersionCommand): Promise<ToolVersion> {
    const tool = await this.deps.tools.findToolById(command.toolId);
    if (tool === null) {
      throw new ToolNotFoundError(command.toolId);
    }

    const version = await this.deps.tools.findToolVersionById(
      command.toolVersionId,
    );
    if (version === null || version.toolId !== command.toolId) {
      throw new ToolVersionNotFoundError(command.toolVersionId);
    }

    return version;
  }
}

export class ListToolVersions {
  constructor(private readonly deps: ToolApplicationDependencies) {}

  async execute(toolId: ToolId): Promise<ToolVersion[]> {
    const tool = await this.deps.tools.findToolById(toolId);
    if (tool === null) {
      throw new ToolNotFoundError(toolId);
    }

    return this.deps.tools.listToolVersions(toolId);
  }
}

export interface ToolApplication {
  readonly createTool: CreateTool;
  readonly getTool: GetTool;
  readonly listTools: ListTools;
  readonly updateToolMetadata: UpdateToolMetadata;
  readonly appendToolVersion: AppendToolVersion;
  readonly getToolVersion: GetToolVersion;
  readonly listToolVersions: ListToolVersions;
}

export function createToolApplication(
  deps: ToolApplicationDependencies,
): ToolApplication {
  return {
    createTool: new CreateTool(deps),
    getTool: new GetTool(deps),
    listTools: new ListTools(deps),
    updateToolMetadata: new UpdateToolMetadata(deps),
    appendToolVersion: new AppendToolVersion(deps),
    getToolVersion: new GetToolVersion(deps),
    listToolVersions: new ListToolVersions(deps),
  };
}
