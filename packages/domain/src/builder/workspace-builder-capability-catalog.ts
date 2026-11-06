import type {
  AgentId,
  AgentVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ModelProvider,
  ToolId,
  ToolType,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "../control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "../control-plane-resource-kinds.js";
import { WorkspaceNotFoundError } from "../errors.js";
import type { AgentRepository } from "../ports/agent-repository.js";
import type { ModelProfileRepository } from "../ports/model-profile-repository.js";
import type { ToolRepository } from "../ports/tool-repository.js";
import type { WorkspaceRepository } from "../ports/workspace-repository.js";

const AGENT_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.agent };
const MODEL_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.modelProfile };
const TOOL_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.tool };

/**
 * Eligibility: domain `AgentVersion`, `ModelProfileVersion`, and `ToolVersion` are immutable
 * snapshots once appended; there is no separate “draft” or “unpublished” lifecycle flag.
 * The catalog therefore lists every version row for workspace-owned agents, profiles, and tools.
 * Operational readiness of external providers or MCP servers is out of scope for M20.1.
 */

/** Allowlisted catalog snapshot for builder proposal compilation (no secrets, no transport). */
export interface WorkspaceBuilderAgentVersionCatalogEntryV1 {
  readonly agentVersionId: AgentVersionId;
  readonly agentId: AgentId;
  readonly agentKey: string;
  readonly agentName: string;
  readonly version: number;
  readonly manifestName: string;
  readonly manifestKey: string;
}

export interface WorkspaceBuilderModelProfileVersionCatalogEntryV1 {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileKey: string;
  readonly modelProfileName: string;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
}

export interface WorkspaceBuilderToolVersionCatalogEntryV1 {
  readonly toolVersionId: ToolVersionId;
  readonly toolId: ToolId;
  readonly toolKey: string;
  readonly toolName: string;
  readonly version: number;
  readonly toolType: ToolType;
}

export interface WorkspaceBuilderCapabilityCatalogV1 {
  readonly workspaceId: WorkspaceId;
  readonly agentVersions: readonly WorkspaceBuilderAgentVersionCatalogEntryV1[];
  readonly modelProfileVersions: readonly WorkspaceBuilderModelProfileVersionCatalogEntryV1[];
  readonly toolVersions: readonly WorkspaceBuilderToolVersionCatalogEntryV1[];
}

export interface WorkspaceBuilderCapabilityCatalogDependencies {
  readonly workspaces: WorkspaceRepository;
  readonly agents: AgentRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly tools: ToolRepository;
}

/**
 * Read-only workspace capability catalog for internal builder flows (M20.1).
 * Enforces workspace scope via {@link ControlPlaneScope}; does not trust IDs in proposal payloads.
 */
export class GetWorkspaceBuilderCapabilityCatalog {
  constructor(
    private readonly deps: WorkspaceBuilderCapabilityCatalogDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
  ): Promise<WorkspaceBuilderCapabilityCatalogV1> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      AGENT_RESOURCE,
    );
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_RESOURCE,
    );
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      TOOL_RESOURCE,
    );

    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const agents = await this.deps.agents.listAgentsByWorkspaceId(workspaceId);
    const agentVersionEntries: WorkspaceBuilderAgentVersionCatalogEntryV1[] =
      [];

    const agentsSorted = [...agents].sort((a, b) => a.key.localeCompare(b.key));
    for (const agent of agentsSorted) {
      const versions = await this.deps.agents.listAgentVersions(agent.id);
      const sortedVersions = [...versions].sort(
        (a, b) => a.version - b.version,
      );
      for (const av of sortedVersions) {
        agentVersionEntries.push({
          agentVersionId: av.id,
          agentId: agent.id,
          agentKey: agent.key,
          agentName: agent.name,
          version: av.version,
          manifestName: av.manifest.name,
          manifestKey: av.manifest.key,
        });
      }
    }

    agentVersionEntries.sort((a, b) => {
      const keyCmp = a.agentKey.localeCompare(b.agentKey);
      if (keyCmp !== 0) {
        return keyCmp;
      }

      return a.version - b.version;
    });

    const profiles =
      await this.deps.modelProfiles.listModelProfilesByWorkspaceId(workspaceId);
    const profileSorted = [...profiles].sort((a, b) =>
      a.key.localeCompare(b.key),
    );

    const modelProfileVersionEntries: WorkspaceBuilderModelProfileVersionCatalogEntryV1[] =
      [];
    for (const profile of profileSorted) {
      const versions = await this.deps.modelProfiles.listModelProfileVersions(
        profile.id,
      );
      const sorted = [...versions].sort((a, b) => a.version - b.version);
      for (const mv of sorted) {
        modelProfileVersionEntries.push({
          modelProfileVersionId: mv.id,
          modelProfileId: profile.id,
          modelProfileKey: profile.key,
          modelProfileName: profile.name,
          version: mv.version,
          provider: mv.provider,
          model: mv.model,
        });
      }
    }

    const toolEntities =
      await this.deps.tools.listToolsByWorkspaceId(workspaceId);
    const toolsSorted = [...toolEntities].sort((a, b) =>
      a.key.localeCompare(b.key),
    );

    const toolVersionEntries: WorkspaceBuilderToolVersionCatalogEntryV1[] = [];
    for (const tool of toolsSorted) {
      const versions = await this.deps.tools.listToolVersions(tool.id);
      const sorted = [...versions].sort((a, b) => a.version - b.version);
      for (const tv of sorted) {
        toolVersionEntries.push({
          toolVersionId: tv.id,
          toolId: tool.id,
          toolKey: tool.key,
          toolName: tool.name,
          version: tv.version,
          toolType: tv.type,
        });
      }
    }

    return {
      workspaceId,
      agentVersions: agentVersionEntries,
      modelProfileVersions: modelProfileVersionEntries,
      toolVersions: toolVersionEntries,
    };
  }
}
