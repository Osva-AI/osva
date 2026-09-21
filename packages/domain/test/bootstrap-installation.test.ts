import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  BootstrapInstallation,
  CreateApiKey,
} from "../src/api-key-application.js";
import {
  BootstrapAlreadyCompletedError,
  BootstrapExistingWorkspaceStateError,
  DuplicateApiKeyIdError,
} from "../src/security-errors.js";
import type {
  ApiKeyCreateRecord,
  ApiKeyPersistedRecord,
  ApiKeyRepository,
} from "../src/ports/api-key-repository.js";
import type { ApiKey } from "../src/api-key.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { Workspace } from "../src/workspace.js";

class MemoryApiKeyRepository implements ApiKeyRepository {
  readonly records: ApiKeyPersistedRecord[] = [];

  async create(record: ApiKeyCreateRecord): Promise<void> {
    if (this.records.some((entry) => entry.apiKey.id === record.apiKey.id)) {
      throw new DuplicateApiKeyIdError(record.apiKey.id);
    }

    this.records.push({
      apiKey: record.apiKey,
      secretDigest: Buffer.from(record.secretDigest),
    });
  }

  async findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null> {
    return this.records.find((record) => record.apiKey.id === id) ?? null;
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null> {
    const record = await this.findById(id);
    if (record === null || record.apiKey.workspaceId !== workspaceId) {
      return null;
    }
    return record.apiKey;
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly ApiKey[]> {
    return this.records
      .map((record) => record.apiKey)
      .filter((apiKey) => apiKey.workspaceId === workspaceId);
  }

  async revoke(id: ApiKeyId, revokedAt: Date): Promise<void> {
    const index = this.records.findIndex((record) => record.apiKey.id === id);
    if (index === -1) {
      return;
    }

    this.records[index] = {
      ...this.records[index]!,
      apiKey: this.records[index]!.apiKey.revoke(revokedAt),
    };
  }

  async countAll(): Promise<number> {
    return this.records.length;
  }
}

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces: Workspace[] = [];

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.push(workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  async countAll(): Promise<number> {
    return this.workspaces.length;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return this.workspaces.map((workspace) => workspace.id);
  }
}

describe("BootstrapInstallation", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  let idCounter = 0;

  function createDeps() {
    return {
      apiKeys: new MemoryApiKeyRepository(),
      workspaces: new MemoryWorkspaceRepository(),
      clock: { now: () => now },
      ids: { createId: () => `id-${String((idCounter += 1))}` },
    };
  }

  it("creates the initial workspace and ADMIN key on an empty installation", async () => {
    const deps = createDeps();
    const bootstrap = new BootstrapInstallation(deps);
    const result = await bootstrap.execute({ workspaceName: "Primary" });

    expect(result.workspace.name).toBe("Primary");
    expect(result.apiKey.role).toBe(COMMUNITY_EDITION_ROLES.ADMIN);
    expect(result.plaintextToken.startsWith("osva_ak_")).toBe(true);
    expect(deps.workspaces.workspaces).toHaveLength(1);
    expect(deps.apiKeys.records).toHaveLength(1);
    expect(deps.apiKeys.records[0]?.secretDigest.length).toBe(32);
  });

  it("refuses duplicate bootstrap when API keys already exist", async () => {
    const deps = createDeps();
    const bootstrap = new BootstrapInstallation(deps);
    await bootstrap.execute({ workspaceName: "Primary" });

    await expect(
      bootstrap.execute({ workspaceName: "Another" }),
    ).rejects.toBeInstanceOf(BootstrapAlreadyCompletedError);
  });

  it("requires explicit workspace targeting when workspaces exist without API keys", async () => {
    const deps = createDeps();
    const existing = Workspace.create({
      id: "ws-existing" as WorkspaceId,
      name: "Existing",
      createdAt: now,
    });
    await deps.workspaces.save(existing);

    const bootstrap = new BootstrapInstallation(deps);
    await expect(
      bootstrap.execute({ workspaceName: "Ignored" }),
    ).rejects.toBeInstanceOf(BootstrapExistingWorkspaceStateError);
    expect(deps.workspaces.workspaces).toHaveLength(1);
    expect(deps.apiKeys.records).toHaveLength(0);
  });

  it("creates the initial ADMIN key for an explicitly targeted existing workspace", async () => {
    const deps = createDeps();
    const existing = Workspace.create({
      id: "ws-target" as WorkspaceId,
      name: "Existing",
      createdAt: now,
    });
    await deps.workspaces.save(existing);

    const bootstrap = new BootstrapInstallation(deps);
    const result = await bootstrap.execute({ workspaceId: existing.id });

    expect(result.workspace.id).toBe(existing.id);
    expect(deps.workspaces.workspaces).toHaveLength(1);
    expect(deps.apiKeys.records).toHaveLength(1);
  });

  it("requires explicit targeting when multiple workspaces exist", async () => {
    const deps = createDeps();
    await deps.workspaces.save(
      Workspace.create({
        id: "ws-a" as WorkspaceId,
        name: "A",
        createdAt: now,
      }),
    );
    await deps.workspaces.save(
      Workspace.create({
        id: "ws-b" as WorkspaceId,
        name: "B",
        createdAt: now,
      }),
    );

    const bootstrap = new BootstrapInstallation(deps);
    await expect(bootstrap.execute({})).rejects.toBeInstanceOf(
      BootstrapExistingWorkspaceStateError,
    );
  });

  it("persists workspace ownership for created API keys", async () => {
    const deps = createDeps();
    const createApiKey = new CreateApiKey(deps);
    const workspace = Workspace.create({
      id: "ws-bootstrap" as WorkspaceId,
      name: "Existing",
      createdAt: now,
    });
    await deps.workspaces.save(workspace);

    const created = await createApiKey.execute({
      workspaceId: workspace.id,
      name: "operator",
      role: COMMUNITY_EDITION_ROLES.OPERATOR,
    });

    expect(created.apiKey.workspaceId).toBe(workspace.id);
    expect(created.plaintextToken.includes(created.apiKey.id)).toBe(true);
  });
});
