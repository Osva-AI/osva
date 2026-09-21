import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import {
  COMMUNITY_EDITION_ROLES,
  OSVA_REQUEST_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
} from "@osva/contracts";
import {
  AuthenticateApiKey,
  CreateApiKey,
  DuplicateApiKeyIdError,
  Workspace,
  createApiKeyApplication,
  type ApiKeyCreateRecord,
  type ApiKeyPersistedRecord,
  type ApiKeyRepository,
  type ApiKey,
  type WorkspaceRepository,
} from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createWebApplication } from "../src/http.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";

class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly records = new Map<ApiKeyId, ApiKeyPersistedRecord>();

  async create(record: ApiKeyCreateRecord): Promise<void> {
    if (this.records.has(record.apiKey.id)) {
      throw new DuplicateApiKeyIdError(record.apiKey.id);
    }

    this.records.set(record.apiKey.id, {
      apiKey: record.apiKey,
      secretDigest: Buffer.from(record.secretDigest),
    });
  }

  async findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null> {
    const record = this.records.get(id);
    if (record === undefined || record.apiKey.workspaceId !== workspaceId) {
      return null;
    }
    return record.apiKey;
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly ApiKey[]> {
    return [...this.records.values()]
      .map((record) => record.apiKey)
      .filter((apiKey) => apiKey.workspaceId === workspaceId);
  }

  async revoke(id: ApiKeyId, revokedAt: Date): Promise<void> {
    const record = this.records.get(id);
    if (record === undefined) {
      return;
    }

    this.records.set(id, {
      ...record,
      apiKey: record.apiKey.revoke(revokedAt),
    });
  }

  async countAll(): Promise<number> {
    return this.records.size;
  }
}

class MemoryWorkspaceRepository implements WorkspaceRepository {
  private saved: Workspace | undefined;

  async save(workspace: Workspace): Promise<void> {
    this.saved = workspace;
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    if (this.saved?.id === id) {
      return this.saved;
    }

    return Workspace.create({
      id,
      name: "Test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  async countAll(): Promise<number> {
    return this.saved === undefined ? 0 : 1;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return this.saved === undefined ? [] : [this.saved.id];
  }
}

describe("GET /v1/auth/context", () => {
  const servers: ReturnType<typeof createWebApplication>[] = [];
  const now = new Date("2026-01-01T00:00:00.000Z");

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  async function listenWithToken(): Promise<{
    origin: string;
    token: string;
    workspaceId: WorkspaceId;
  }> {
    const workspaceId = "ws-auth-http" as WorkspaceId;
    const apiKeys = new MemoryApiKeyRepository();
    const workspaces = new MemoryWorkspaceRepository();
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Test", createdAt: now }),
    );
    const createApiKey = new CreateApiKey({
      apiKeys,
      workspaces,
      clock: { now: () => now },
      ids: { createId: () => "ak-http" },
    });
    const created = await createApiKey.execute({
      workspaceId,
      name: "admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });
    const authenticateApiKey = new AuthenticateApiKey({
      apiKeys,
      clock: { now: () => now },
    });
    const server = createWebApplication({
      readinessCheck: async () => true,
      agents: {} as never,
      connectors: {} as never,
      memory: {} as never,
      artifacts: {} as never,
      artifactMaxBytes: 1,
      evaluations: {} as never,
      modelProfiles: {} as never,
      tools: {} as never,
      runs: {} as never,
      runObservability: {} as never,
      schedules: {} as never,
      workflows: {} as never,
      office: {} as never,
      knowledge: {} as never,
      apiKeys: createApiKeyApplication({
        apiKeys,
        workspaces,
        clock: { now: () => now },
        ids: { createId: () => "ak-http" },
      }),
      security: {
        authenticateBearerToken: (token) => authenticateApiKey.execute(token),
      },
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      token: created.plaintextToken,
      workspaceId,
    };
  }

  it("returns stable authentication failures without leaking credentials", async () => {
    const { origin, token } = await listenWithToken();

    const unauthenticated = await fetch(`${origin}/v1/auth/context`);
    const unauthenticatedBody = (await unauthenticated.json()) as {
      code?: string;
      requestId?: string;
    };
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticatedBody.code).toBe(
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
    );
    expect(unauthenticated.headers.get(OSVA_REQUEST_ID_HEADER)).toBeTruthy();
    expect(JSON.stringify(unauthenticatedBody)).not.toContain(token);

    const invalid = await fetch(`${origin}/v1/auth/context`, {
      headers: { authorization: "Bearer osva_ak_bad.secret" },
    });
    expect(invalid.status).toBe(401);
    expect((await invalid.json()) as { code?: string }).toEqual({
      status: "error",
      code: PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId: expect.any(String),
    });
  });

  it("returns authenticated context and a server-generated request ID", async () => {
    const { origin, token, workspaceId } = await listenWithToken();
    const response = await fetch(`${origin}/v1/auth/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      subjectId: string;
      workspaceId: WorkspaceId;
      role: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      subjectId: "ak-http",
      workspaceId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });
    expect(response.headers.get(OSVA_REQUEST_ID_HEADER)).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
