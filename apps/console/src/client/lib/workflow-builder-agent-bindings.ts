export interface AgentVersionCatalogEntry {
  readonly agentId: string;
  readonly versions: ReadonlyArray<{ readonly id: string }>;
}

export interface BoundAgentNodeRef {
  readonly key: string;
  readonly agentVersionId: string;
}

export interface ResolvedAgentBindings {
  readonly agentIdByNodeKey: Readonly<Record<string, string>>;
  readonly unavailableVersionByNodeKey: Readonly<Record<string, boolean>>;
}

/**
 * Maps each bound agentVersionId to the owning agent by scanning immutable
 * version catalogs. Never mutates or substitutes version ids.
 */
export function resolveAgentBindingsFromCatalog(
  nodes: readonly BoundAgentNodeRef[],
  catalog: readonly AgentVersionCatalogEntry[],
): ResolvedAgentBindings {
  const agentIdByNodeKey: Record<string, string> = {};
  const unavailableVersionByNodeKey: Record<string, boolean> = {};

  for (const node of nodes) {
    const versionId = node.agentVersionId.trim();
    if (versionId.length === 0) {
      continue;
    }

    let ownerAgentId: string | undefined;
    for (const entry of catalog) {
      if (entry.versions.some((version) => version.id === versionId)) {
        ownerAgentId = entry.agentId;
        break;
      }
    }

    if (ownerAgentId !== undefined) {
      agentIdByNodeKey[node.key] = ownerAgentId;
    } else {
      unavailableVersionByNodeKey[node.key] = true;
    }
  }

  return { agentIdByNodeKey, unavailableVersionByNodeKey };
}
