import type { ToolId, ToolVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateToolKeyError,
  Tool,
  ToolNotFoundError,
  ToolVersion,
  type AppendToolVersionInput,
  type ToolMetadataUpdate,
  type ToolRepository,
} from "@osva/domain";

export class MemoryToolRepository implements ToolRepository {
  private readonly tools = new Map<ToolId, Tool>();
  private readonly versions = new Map<ToolVersionId, ToolVersion>();

  async saveTool(tool: Tool): Promise<void> {
    for (const existing of this.tools.values()) {
      if (
        existing.id !== tool.id &&
        existing.workspaceId === tool.workspaceId &&
        existing.key === tool.key
      ) {
        throw new DuplicateToolKeyError(tool.workspaceId, tool.key);
      }
    }

    this.tools.set(tool.id, tool);
  }

  async findToolById(id: ToolId): Promise<Tool | null> {
    return this.tools.get(id) ?? null;
  }

  async listTools(): Promise<Tool[]> {
    return [...this.tools.values()].sort(compareTools);
  }

  async updateToolMetadata(
    id: ToolId,
    metadata: ToolMetadataUpdate,
  ): Promise<Tool | null> {
    const existing = this.tools.get(id);
    if (existing === undefined) {
      return null;
    }

    const updated = existing.withName(metadata.name);
    this.tools.set(id, updated);
    return updated;
  }

  async saveToolVersion(version: ToolVersion): Promise<void> {
    const existing = this.versions.get(version.id);

    if (existing && !isSameToolVersion(existing, version)) {
      throw new DomainInvariantError(
        `ToolVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    if (!existing) {
      for (const stored of this.versions.values()) {
        if (
          stored.toolId === version.toolId &&
          stored.version === version.version
        ) {
          throw new DomainInvariantError(
            `ToolVersion already exists for tool '${version.toolId}' version ${String(version.version)}.`,
          );
        }
      }
    }

    this.versions.set(version.id, existing ?? version);
  }

  async appendToolVersion(input: AppendToolVersionInput): Promise<ToolVersion> {
    if (!this.tools.has(input.toolId)) {
      throw new ToolNotFoundError(input.toolId);
    }

    let maxVersion = 0;
    for (const stored of this.versions.values()) {
      if (stored.toolId === input.toolId && stored.version > maxVersion) {
        maxVersion = stored.version;
      }
    }

    const version = ToolVersion.create({
      id: input.id,
      toolId: input.toolId,
      version: maxVersion + 1,
      type: input.type,
      implementation: input.implementation,
      mcp: input.mcp,
      createdAt: input.createdAt,
    });

    await this.saveToolVersion(version);
    return version;
  }

  async findToolVersionById(id: ToolVersionId): Promise<ToolVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listToolVersions(toolId: ToolId): Promise<ToolVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.toolId === toolId)
      .sort((left, right) => left.version - right.version);
  }
}

function compareTools(left: Tool, right: Tool): number {
  const createdAtDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function isSameToolVersion(left: ToolVersion, right: ToolVersion): boolean {
  return (
    left.id === right.id &&
    left.toolId === right.toolId &&
    left.version === right.version &&
    left.type === right.type &&
    left.implementation === right.implementation &&
    JSON.stringify(left.mcp) === JSON.stringify(right.mcp) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
