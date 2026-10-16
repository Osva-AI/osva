import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { OsvaClient } from "@osva-ai/sdk";

import { HELLO_AGENT_KEY, HELLO_AGENT_NAME } from "./constants.js";
import {
  buildHelloAgentManifest,
  manifestFingerprint,
  manifestsMatch,
} from "./manifest.js";
import {
  readHelloState,
  writeHelloState,
  type HelloAgentState,
} from "./state.js";

type SdkAgentVersionManifest = Parameters<
  OsvaClient["agents"]["createVersion"]
>[1]["manifest"];

function cloneManifest(manifest: AgentManifestV1): SdkAgentVersionManifest {
  return JSON.parse(JSON.stringify(manifest)) as SdkAgentVersionManifest;
}

export async function ensureHelloAgentVersion(input: {
  readonly client: OsvaClient;
  readonly workspaceId: string;
  readonly integrity: string;
}): Promise<{
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly reused: boolean;
}> {
  const desiredManifest = await buildHelloAgentManifest({
    integrity: input.integrity,
  });
  const fingerprint = manifestFingerprint(desiredManifest);

  const cached = await readHelloState();
  if (
    cached !== null &&
    cached.workspaceId === input.workspaceId &&
    cached.integrity === input.integrity &&
    cached.manifestFingerprint === fingerprint
  ) {
    const verified = await verifyCachedVersion(
      input.client,
      input.workspaceId,
      cached,
      desiredManifest,
    );
    if (verified !== null) {
      return { ...verified, reused: true };
    }
  }

  const agentId = await ensureAgent(input.client, input.workspaceId);
  const existingVersion = await findCompatibleVersion(
    input.client,
    agentId,
    desiredManifest,
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
    manifest: cloneManifest(desiredManifest),
  });
  await persistState(input, fingerprint, agentId, created.id);
  return { agentId, agentVersionId: created.id, reused: false };
}

async function verifyCachedVersion(
  client: OsvaClient,
  workspaceId: string,
  cached: HelloAgentState,
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
): Promise<AgentId> {
  const listed = await client.agents.list();
  const existing = listed.agents.find((agent) => agent.key === HELLO_AGENT_KEY);
  if (existing !== undefined) {
    if (existing.workspaceId !== (workspaceId as WorkspaceId)) {
      throw new Error(
        `Agent key '${HELLO_AGENT_KEY}' exists in a different workspace. Use the API key for workspace ${workspaceId}.`,
      );
    }
    return existing.id;
  }
  const created = await client.agents.create({
    key: HELLO_AGENT_KEY,
    name: HELLO_AGENT_NAME,
  });
  if (created.workspaceId !== (workspaceId as WorkspaceId)) {
    throw new Error(
      "Created Agent workspace does not match OSVA_WORKSPACE_ID.",
    );
  }
  return created.id;
}

/**
 * Reuses the newest AgentVersion whose immutable manifest matches. OSVA allows
 * duplicate manifest snapshots under concurrent setup; two parallel hello runs
 * may still create two versions until a later run reuses one via this scan.
 */
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
    readonly workspaceId: string;
    readonly integrity: string;
  },
  fingerprint: string,
  agentId: AgentId,
  agentVersionId: AgentVersionId,
): Promise<void> {
  await writeHelloState({
    schemaVersion: "1",
    workspaceId: input.workspaceId,
    agentId,
    agentVersionId,
    manifestFingerprint: fingerprint,
    integrity: input.integrity,
    updatedAt: new Date().toISOString(),
  });
}
