import type { AgentManifestV1, WorkspaceId } from "@osva-ai/contracts";

import {
  InvalidKnowledgeBindingError,
  InvalidMemoryBindingError,
  InvalidModelBindingError,
  InvalidToolBindingError,
} from "../errors.js";
import { knowledgeIndexBindingsFromManifest } from "../knowledge-index-bindings.js";
import { memoryNamespaceBindingsFromManifest } from "../memory-bindings.js";
import { modelProfileVersionBindingsFromManifest } from "../model-bindings.js";
import { toolVersionBindingsFromManifest } from "../tool-bindings.js";
import type { KnowledgeRepository } from "../ports/knowledge-repository.js";
import type { MemoryNamespaceRepository } from "../ports/memory-namespace-repository.js";
import type { ModelProfileRepository } from "../ports/model-profile-repository.js";
import type { ToolRepository } from "../ports/tool-repository.js";

export interface AgentManifestWorkspaceBindingRepositories {
  readonly modelProfiles: ModelProfileRepository;
  readonly tools: ToolRepository;
  readonly memoryNamespaces: MemoryNamespaceRepository;
  readonly knowledge: KnowledgeRepository;
}

export async function assertAgentManifestWorkspaceBindings(
  workspaceId: WorkspaceId,
  manifest: AgentManifestV1,
  deps: AgentManifestWorkspaceBindingRepositories,
): Promise<void> {
  const bindings = modelProfileVersionBindingsFromManifest(manifest);
  for (const [name, modelProfileVersionId] of Object.entries(bindings)) {
    const version = await deps.modelProfiles.findModelProfileVersionById(
      modelProfileVersionId,
    );
    if (version === null) {
      throw new InvalidModelBindingError(
        `Model binding '${name}' references unknown ModelProfileVersion '${modelProfileVersionId}'.`,
      );
    }

    const profile = await deps.modelProfiles.findModelProfileById(
      version.modelProfileId,
    );
    if (profile === null || profile.workspaceId !== workspaceId) {
      throw new InvalidModelBindingError(
        `Model binding '${name}' does not belong to workspace '${workspaceId}'.`,
      );
    }
  }

  const toolBindings = toolVersionBindingsFromManifest(manifest);
  for (const [name, toolVersionId] of Object.entries(toolBindings)) {
    const version = await deps.tools.findToolVersionById(toolVersionId);
    if (version === null) {
      throw new InvalidToolBindingError(
        `Tool binding '${name}' references unknown ToolVersion '${toolVersionId}'.`,
      );
    }

    const tool = await deps.tools.findToolById(version.toolId);
    if (tool === null || tool.workspaceId !== workspaceId) {
      throw new InvalidToolBindingError(
        `Tool binding '${name}' does not belong to workspace '${workspaceId}'.`,
      );
    }
  }

  const memoryBindings = memoryNamespaceBindingsFromManifest(manifest);
  for (const [name, binding] of Object.entries(memoryBindings)) {
    const namespace = await deps.memoryNamespaces.findNamespaceById(
      binding.namespaceId,
    );
    if (namespace === null) {
      throw new InvalidMemoryBindingError(
        `Memory binding '${name}' references unknown MemoryNamespace '${binding.namespaceId}'.`,
      );
    }

    if (namespace.workspaceId !== workspaceId) {
      throw new InvalidMemoryBindingError(
        `Memory binding '${name}' does not belong to workspace '${workspaceId}'.`,
      );
    }
  }

  const knowledgeBindings = knowledgeIndexBindingsFromManifest(manifest);
  for (const [name, indexIds] of Object.entries(knowledgeBindings)) {
    for (const knowledgeIndexId of indexIds) {
      const index = await deps.knowledge.findIndexById(knowledgeIndexId);
      if (index === null) {
        throw new InvalidKnowledgeBindingError(
          `Knowledge binding '${name}' references unknown KnowledgeIndex '${knowledgeIndexId}'.`,
        );
      }

      if (index.workspaceId !== workspaceId) {
        throw new InvalidKnowledgeBindingError(
          `Knowledge binding '${name}' does not belong to workspace '${workspaceId}'.`,
        );
      }

      if (index.status !== "READY") {
        throw new InvalidKnowledgeBindingError(
          `Knowledge binding '${name}' references KnowledgeIndex '${knowledgeIndexId}' that is not READY.`,
        );
      }
    }
  }
}
