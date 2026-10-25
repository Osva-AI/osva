import type { ApiKeyId, WorkspaceId } from "@osva-ai/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  CreateApiKey,
  createApiKeyApplication,
} from "../src/api-key-application.js";
import {
  ApiKeyNotFoundError,
  PermissionDeniedError,
} from "../src/security-errors.js";
import type {
  ApiKeyCreateRecord,
  ApiKeyCreateWithAuditInput,
  ApiKeyPersistedRecord,
  ApiKeyRepository,
  ApiKeyRevokeWithAuditInput,
} from "../src/ports/api-key-repository.js";
import type { ApiKey } from "../src/api-key.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { Workspace } from "../src/workspace.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";

const WS_A = "ws-a" as WorkspaceId;
const WS_B = "ws-b" as WorkspaceId;
const NOW = new Date("2026-01-01T00:00:00.000Z");

class MemoryApiKeyRepository implements ApiKeyRepository {
  readonly records: ApiKeyPersistedRecord[] = [];

  async create(record: ApiKeyCreateRecord): Promise<void> {
    this.records.push({
      apiKey: record.apiKey,
      secretDigest: Buffer.from(record.secretDigest),
    });
  }

  async createWithAudit(input: ApiKeyCreateWithAuditInput): Promise<void> {
    await this.create(input.record);
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

  async revokeWithAudit(input: ApiKeyRevokeWithAuditInput): Promise<ApiKey> {
    const record = await this.findByWorkspaceAndId(
      input.workspaceId,
      input.apiKeyId,
    );
    if (record === null) {
      throw new ApiKeyNotFoundError(input.apiKeyId);
    }

    if (record.revokedAt !== undefined) {
      return record;
    }

    await this.revoke(input.apiKeyId, input.revokedAt);
    const updated = await this.findByWorkspaceAndId(
      input.workspaceId,
      input.apiKeyId,
    );
    if (updated === null) {
      throw new ApiKeyNotFoundError(input.apiKeyId);
    }

    return updated;
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

  async listUnlinkedIds(): Promise<readonly WorkspaceId[]> {
    return this.workspaces
      .filter((workspace) => workspace.organizationId === undefined)
      .map((workspace) => workspace.id);
  }
}

describe("workspace API-key application authorization", () => {
  let idCounter = 0;

  function createDeps() {
    return {
      apiKeys: new MemoryApiKeyRepository(),
      workspaces: new MemoryWorkspaceRepository(),
      clock: { now: () => NOW },
      ids: { createId: () => `ak-${String((idCounter += 1))}` },
    };
  }

  async function seededApplication() {
    const deps = createDeps();
    await deps.workspaces.save(
      Workspace.create({ id: WS_A, name: "A", createdAt: NOW }),
    );
    await deps.workspaces.save(
      Workspace.create({ id: WS_B, name: "B", createdAt: NOW }),
    );

    const createApiKey = new CreateApiKey(deps);
    const inA = await createApiKey.execute({
      workspaceId: WS_A,
      name: "workspace-a-admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });
    const inB = await createApiKey.execute({
      workspaceId: WS_B,
      name: "workspace-b-admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    return {
      deps,
      app: createApiKeyApplication(deps),
      inA,
      inB,
    };
  }

  it("requires ADMIN to list workspace API keys", async () => {
    const { app, inA } = await seededApplication();

    for (const role of [
      COMMUNITY_EDITION_ROLES.VIEWER,
      COMMUNITY_EDITION_ROLES.OPERATOR,
      COMMUNITY_EDITION_ROLES.EDITOR,
    ] as const) {
      await expect(
        app.listWorkspaceApiKeys.execute(fakeControlPlaneScope(WS_A, role)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    }

    const listed = await app.listWorkspaceApiKeys.execute(
      fakeControlPlaneScope(WS_A, COMMUNITY_EDITION_ROLES.ADMIN),
    );
    expect(listed.map((apiKey) => apiKey.id)).toEqual([inA.apiKey.id]);
    expect(JSON.stringify(listed)).not.toContain(inA.plaintextToken);
    expect(JSON.stringify(listed)).not.toMatch(/secretDigest|plaintextToken/i);
  });

  it("scopes list and revoke to the authenticated workspace", async () => {
    const { app, inA, inB } = await seededApplication();
    const scopeA = fakeControlPlaneScope(WS_A, COMMUNITY_EDITION_ROLES.ADMIN);

    const listed = await app.listWorkspaceApiKeys.execute(scopeA);
    expect(listed.every((apiKey) => apiKey.workspaceId === WS_A)).toBe(true);
    expect(listed.some((apiKey) => apiKey.id === inB.apiKey.id)).toBe(false);

    await expect(
      app.revokeWorkspaceApiKey.execute(scopeA, inB.apiKey.id),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);

    const revoked = await app.revokeWorkspaceApiKey.execute(
      scopeA,
      inA.apiKey.id,
    );
    expect(revoked.revokedAt).toEqual(NOW);
  });

  it("requires ADMIN to create and revoke workspace API keys", async () => {
    const { app, inA } = await seededApplication();
    const createCommand = {
      name: "operator-bot",
      role: COMMUNITY_EDITION_ROLES.OPERATOR,
    };

    for (const role of [
      COMMUNITY_EDITION_ROLES.VIEWER,
      COMMUNITY_EDITION_ROLES.OPERATOR,
      COMMUNITY_EDITION_ROLES.EDITOR,
    ] as const) {
      const scope = fakeControlPlaneScope(WS_A, role);
      await expect(
        app.createWorkspaceApiKey.execute(scope, createCommand),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        app.revokeWorkspaceApiKey.execute(scope, inA.apiKey.id),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    }

    const created = await app.createWorkspaceApiKey.execute(
      fakeControlPlaneScope(WS_A, COMMUNITY_EDITION_ROLES.ADMIN),
      createCommand,
    );
    expect(created.apiKey.role).toBe(COMMUNITY_EDITION_ROLES.OPERATOR);
    expect(created.plaintextToken.startsWith("osva_ak_")).toBe(true);
    expect(created.apiKey.workspaceId).toBe(WS_A);
  });
});
