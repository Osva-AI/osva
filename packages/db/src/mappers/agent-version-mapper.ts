import type { AgentId, AgentManifestV1, AgentVersionId } from "@osva/contracts";
import { AgentVersion, DomainInvariantError } from "@osva/domain";

import type { agentVersions } from "../schema/agent-versions.js";
import { canonicalJson } from "./canonical-json.js";
import { toDomainDate } from "./timestamps.js";

type AgentVersionRow = typeof agentVersions.$inferSelect;

export function agentVersionToRow(agentVersion: AgentVersion) {
  return {
    id: agentVersion.id,
    agentId: agentVersion.agentId,
    version: agentVersion.version,
    manifest: asJsonObject(agentVersion.manifest),
    createdAt: agentVersion.createdAt,
  };
}

export function agentVersionFromRow(row: AgentVersionRow): AgentVersion {
  return AgentVersion.create({
    id: row.id as AgentVersionId,
    agentId: row.agentId as AgentId,
    version: row.version,
    manifest: toManifest(row.manifest),
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameAgentVersion(
  left: AgentVersion,
  right: AgentVersion,
): boolean {
  return (
    left.id === right.id &&
    left.agentId === right.agentId &&
    left.version === right.version &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    canonicalJson(left.manifest) === canonicalJson(right.manifest)
  );
}

function toManifest(value: unknown): AgentManifestV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted AgentVersion.manifest must be an object.",
    );
  }

  return value as AgentManifestV1;
}

function asJsonObject(value: object): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}
