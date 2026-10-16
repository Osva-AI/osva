import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { OsvaClient } from "@osva-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHelloAgentManifest,
  manifestFingerprint,
  manifestsMatch,
} from "../scripts/lib/manifest.js";

const workspaceId = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const agentId = "00000000-0000-4000-8000-000000000010" as AgentId;
const firstVersionId = "00000000-0000-4000-8000-000000000020" as AgentVersionId;
const secondVersionId =
  "00000000-0000-4000-8000-000000000021" as AgentVersionId;

const readHelloState = vi.fn<() => Promise<unknown>>();
const writeHelloState = vi.fn<(state: unknown) => Promise<void>>();

vi.mock("../scripts/lib/state.js", () => ({
  readHelloState: () => readHelloState(),
  writeHelloState: (state: unknown) => writeHelloState(state),
}));

const { ensureHelloAgentVersion } = await import("../scripts/lib/ensure.js");

/** Simulates PostgreSQL jsonb / API responses that reorder object keys only. */
function apiOrderedManifest(manifest: AgentManifestV1): AgentManifestV1 {
  const inputSchema = manifest.input.schema as Record<string, unknown>;
  const outputSchema = manifest.output.schema as Record<string, unknown>;
  return {
    ...manifest,
    input: {
      schema: {
        properties: inputSchema.properties,
        required: inputSchema.required,
        type: inputSchema.type,
        additionalProperties: inputSchema.additionalProperties,
        $schema: inputSchema.$schema,
      },
    },
    output: {
      schema: {
        properties: outputSchema.properties,
        required: outputSchema.required,
        type: outputSchema.type,
        additionalProperties: outputSchema.additionalProperties,
        $schema: outputSchema.$schema,
      },
    },
  };
}

function buildClient(input: {
  readonly versions: readonly {
    readonly id: AgentVersionId;
    readonly manifest: AgentManifestV1;
  }[];
  readonly createVersion?: ReturnType<typeof vi.fn>;
}): OsvaClient {
  const createVersion =
    input.createVersion ??
    vi.fn(async () => {
      throw new Error("createVersion should not be called");
    });

  return {
    agents: {
      list: vi.fn(async () => ({
        agents: [
          {
            id: agentId,
            workspaceId,
            key: "hello-agent",
            name: "Hello Agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })),
      get: vi.fn(async () => ({
        id: agentId,
        workspaceId,
        key: "hello-agent",
        name: "Hello Agent",
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
      create: vi.fn(),
      listVersions: vi.fn(async () => ({
        versions: input.versions.map((version, index) => ({
          id: version.id,
          agentId,
          version: index + 1,
          manifest: version.manifest,
          createdAt: "2026-01-01T00:00:00.000Z",
        })),
      })),
      getVersion: vi.fn(async (_agentId, versionId) => {
        const found = input.versions.find(
          (version) => version.id === versionId,
        );
        if (found === undefined) {
          throw new Error("version not found");
        }
        return {
          id: found.id,
          agentId,
          version: 1,
          manifest: found.manifest,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      }),
      createVersion,
    },
  } as unknown as OsvaClient;
}

describe("ensureHelloAgentVersion", () => {
  beforeEach(() => {
    readHelloState.mockReset();
    writeHelloState.mockReset();
    readHelloState.mockResolvedValue(null);
  });

  it("reuses an existing version when local state is absent (jsonb key order)", async () => {
    const digest = `sha256:${"e".repeat(64)}`;
    const desired = await buildHelloAgentManifest({ integrity: digest });
    const stored = apiOrderedManifest(desired);
    expect(manifestsMatch(stored, desired)).toBe(true);

    const createVersion = vi.fn();
    const client = buildClient({
      versions: [{ id: firstVersionId, manifest: stored }],
      createVersion,
    });

    const result = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: digest,
    });

    expect(result).toEqual({
      agentId,
      agentVersionId: firstVersionId,
      reused: true,
    });
    expect(createVersion).not.toHaveBeenCalled();
    expect(writeHelloState).toHaveBeenCalledOnce();
  });

  it("creates a new version when immutable configuration changes", async () => {
    const digest = `sha256:${"f".repeat(64)}`;
    const otherDigest = `sha256:${"0".repeat(64)}`;
    const existing = apiOrderedManifest(
      await buildHelloAgentManifest({ integrity: digest }),
    );
    const createVersion = vi.fn(async () => ({
      id: secondVersionId,
      agentId,
      version: 2,
      manifest: await buildHelloAgentManifest({ integrity: otherDigest }),
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const client = buildClient({
      versions: [{ id: firstVersionId, manifest: existing }],
      createVersion,
    });

    const result = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: otherDigest,
    });

    expect(result.reused).toBe(false);
    expect(result.agentVersionId).toBe(secondVersionId);
    expect(createVersion).toHaveBeenCalledOnce();
  });

  it("reuses via cached identifiers when manifest still matches", async () => {
    const digest = `sha256:${"1".repeat(64)}`;
    const desired = await buildHelloAgentManifest({ integrity: digest });
    const stored = apiOrderedManifest(desired);
    readHelloState.mockResolvedValue({
      schemaVersion: "1",
      workspaceId,
      agentId,
      agentVersionId: firstVersionId,
      manifestFingerprint: manifestFingerprint(desired),
      integrity: digest,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const createVersion = vi.fn();
    const client = buildClient({
      versions: [{ id: firstVersionId, manifest: stored }],
      createVersion,
    });

    const result = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: digest,
    });

    expect(result).toEqual({
      agentId,
      agentVersionId: firstVersionId,
      reused: true,
    });
    expect(createVersion).not.toHaveBeenCalled();
    expect(client.agents.listVersions).not.toHaveBeenCalled();
  });

  it("recovers from stale cached agentVersionId via version list scan", async () => {
    const digest = `sha256:${"2".repeat(64)}`;
    const desired = await buildHelloAgentManifest({ integrity: digest });
    const stored = apiOrderedManifest(desired);
    readHelloState.mockResolvedValue({
      schemaVersion: "1",
      workspaceId,
      agentId,
      agentVersionId: "00000000-0000-4000-8000-000000000099",
      manifestFingerprint: manifestFingerprint(desired),
      integrity: digest,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const createVersion = vi.fn();
    const client = buildClient({
      versions: [{ id: firstVersionId, manifest: stored }],
      createVersion,
    });

    const result = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: digest,
    });

    expect(result).toEqual({
      agentId,
      agentVersionId: firstVersionId,
      reused: true,
    });
    expect(createVersion).not.toHaveBeenCalled();
  });

  it("reuses the same AgentVersion on consecutive identical ensure calls", async () => {
    const digest = `sha256:${"3".repeat(64)}`;
    const desired = await buildHelloAgentManifest({ integrity: digest });
    const stored = apiOrderedManifest(desired);
    const createVersion = vi.fn();
    const client = buildClient({
      versions: [{ id: firstVersionId, manifest: stored }],
      createVersion,
    });

    const first = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: digest,
    });
    const second = await ensureHelloAgentVersion({
      client,
      workspaceId,
      integrity: digest,
    });

    expect(first.reused).toBe(true);
    expect(second.reused).toBe(true);
    expect(first.agentVersionId).toBe(second.agentVersionId);
    expect(createVersion).not.toHaveBeenCalled();
  });
});
