import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { OsvaClient } from "@osva-ai/sdk";

import { manifestFingerprint, manifestsMatch } from "./manifest.js";
import {
  readDeploymentState,
  writeDeploymentState,
  type ProjectDeploymentState,
} from "./state.js";

type SdkAgentVersionManifest = Parameters<
  OsvaClient["agents"]["createVersion"]
>[1]["manifest"];

function cloneManifest(manifest: AgentManifestV1): SdkAgentVersionManifest {
  return JSON.parse(JSON.stringify(manifest)) as SdkAgentVersionManifest;
}

export async function ensureAgentVersion(input: {
  readonly client: OsvaClient;
  readonly projectDir: string;
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly manifest: AgentManifestV1;
  readonly integrity: string;
  readonly deployTarget: string;
  readonly entrypoint: string;
}): Promise<{
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly reused: boolean;
}> {
  const fingerprint = manifestFingerprint(input.manifest);
  const agentKey = input.manifest.key;

  const cached = await readDeploymentState(input.projectDir);
  if (
    cached !== null &&
    cached.baseUrl === input.baseUrl &&
    cached.workspaceId === input.workspaceId &&
    cached.agentKey === agentKey &&
    cached.integrity === input.integrity &&
    cached.manifestFingerprint === fingerprint
  ) {
    const verified = await verifyCachedVersion(
      input.client,
      input.workspaceId,
      cached,
      input.manifest,
    );
    if (verified !== null) {
      return { ...verified, reused: true };
    }
  }

  const agentId = await ensureAgent(
    input.client,
    input.workspaceId,
    agentKey,
    input.manifest.name,
  );
  const existingVersion = await findCompatibleVersion(
    input.client,
    agentId,
    input.manifest,
  );
  if (existingVersion !== null) {
    await persistState(input, fingerprint, agentId, existingVersion);
    return {
      agentId,
      agentVersionId: existingVersion,
      reused: true,
    };
  }

  const created = await input.client.agents.createVersion(agentId, {
    manifest: cloneManifest(input.manifest),
  });
  await persistState(input, fingerprint, agentId, created.id);
  return { agentId, agentVersionId: created.id, reused: false };
}

async function verifyCachedVersion(
  client: OsvaClient,
  workspaceId: string,
  cached: ProjectDeploymentState,
  desiredManifest: AgentManifestV1,
): Promise<{ agentId: AgentId; agentVersionId: AgentVersionId } | null> {
  try {
    const agent = await client.agents.get(cached.agentId as AgentId);
    if (agent.workspaceId !== (workspaceId as WorkspaceId)) {
      return null;
    }
    const version = await client.agents.getVersion(
      cached.agentId as AgentId,
      cached.agentVersionId as AgentVersionId,
    );
    if (!manifestsMatch(version.manifest as AgentManifestV1, desiredManifest)) {
      return null;
    }
    return {
      agentId: cached.agentId as AgentId,
      agentVersionId: cached.agentVersionId as AgentVersionId,
    };
  } catch {
    return null;
  }
}

async function ensureAgent(
  client: OsvaClient,
  workspaceId: string,
  agentKey: string,
  agentName: string,
): Promise<AgentId> {
  const listed = await client.agents.list();
  const existing = listed.agents.find((agent) => agent.key === agentKey);
  if (existing !== undefined) {
    if (existing.workspaceId !== (workspaceId as WorkspaceId)) {
      throw new Error(
        `Agent key '${agentKey}' exists in a different workspace. Use the API key for workspace ${workspaceId}.`,
      );
    }
    return existing.id;
  }
  const created = await client.agents.create({
    key: agentKey,
    name: agentName,
  });
  if (created.workspaceId !== (workspaceId as WorkspaceId)) {
    throw new Error(
      "Created Agent workspace does not match the authenticated workspace.",
    );
  }
  return created.id;
}

async function findCompatibleVersion(
  client: OsvaClient,
  agentId: AgentId,
  desiredManifest: AgentManifestV1,
): Promise<AgentVersionId | null> {
  const listed = await client.agents.listVersions(agentId);
  for (const summary of [...listed.versions].reverse()) {
    if (manifestsMatch(summary.manifest as AgentManifestV1, desiredManifest)) {
      return summary.id;
    }
  }
  return null;
}

async function persistState(
  input: {
    readonly projectDir: string;
    readonly baseUrl: string;
    readonly workspaceId: string;
    readonly manifest: AgentManifestV1;
    readonly integrity: string;
    readonly deployTarget: string;
    readonly entrypoint: string;
  },
  fingerprint: string,
  agentId: AgentId,
  agentVersionId: AgentVersionId,
): Promise<void> {
  const previous = await readDeploymentState(input.projectDir);
  await writeDeploymentState(input.projectDir, {
    schemaVersion: "1",
    baseUrl: input.baseUrl,
    workspaceId: input.workspaceId,
    agentKey: input.manifest.key,
    agentId,
    agentVersionId,
    manifestFingerprint: fingerprint,
    integrity: input.integrity,
    deployTarget: input.deployTarget,
    entrypoint: input.entrypoint,
    updatedAt: new Date().toISOString(),
    ...(previous?.lastRunId === undefined
      ? {}
      : { lastRunId: previous.lastRunId }),
    ...(previous?.lastRunAttemptId === undefined
      ? {}
      : { lastRunAttemptId: previous.lastRunAttemptId }),
  });
}
