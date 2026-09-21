import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { ApiKey } from "../src/api-key.js";
import {
  generateApiKeySecretMaterial,
  verifyApiKeySecret,
} from "../src/api-key-credential.js";
import { AuthenticateApiKey } from "../src/authenticate-api-key.js";
import { DuplicateApiKeyIdError } from "../src/security-errors.js";
import type {
  ApiKeyCreateRecord,
  ApiKeyPersistedRecord,
  ApiKeyRepository,
} from "../src/ports/api-key-repository.js";

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

describe("AuthenticateApiKey", () => {
  const workspaceId = "ws-auth" as WorkspaceId;
  const apiKeyId = "ak-1" as ApiKeyId;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const clock = { now: () => now };

  async function seedRecord(
    repository: MemoryApiKeyRepository,
    options: {
      readonly expiresAt?: Date;
      readonly revokedAt?: Date;
    } = {},
  ): Promise<string> {
    const material = generateApiKeySecretMaterial(apiKeyId);
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId,
      name: "test",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      now,
      expiresAt: options.expiresAt,
    });
    const stored =
      options.revokedAt === undefined
        ? apiKey
        : apiKey.revoke(options.revokedAt);

    await repository.create({
      apiKey: stored,
      secretDigest: material.secretDigest,
    });
    return material.plaintextToken;
  }

  it("authenticates valid keys and derives workspace and role", async () => {
    const repository = new MemoryApiKeyRepository();
    const token = await seedRecord(repository);
    const authenticator = new AuthenticateApiKey({
      apiKeys: repository,
      clock,
    });

    const principal = await authenticator.execute(token);
    expect(principal).toEqual({
      subjectId: apiKeyId,
      workspaceId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      authenticationMethod: "API_KEY",
    });
  });

  it("fails uniformly for missing, malformed, unknown, wrong, revoked, and expired credentials", async () => {
    const repository = new MemoryApiKeyRepository();
    const token = await seedRecord(repository);
    const authenticator = new AuthenticateApiKey({
      apiKeys: repository,
      clock,
    });

    expect(await authenticator.execute("")).toBeNull();
    expect(await authenticator.execute("not-a-token")).toBeNull();
    expect(await authenticator.execute(`${token}x`)).toBeNull();
    expect(await authenticator.execute(token.replace(/.$/, "x"))).toBeNull();
    expect(
      await authenticator.execute(token.replace(apiKeyId, "missing-key-id")),
    ).toBeNull();

    const revokedRepository = new MemoryApiKeyRepository();
    const revokedToken = await seedRecord(revokedRepository, {
      revokedAt: now,
    });
    const revokedAuthenticator = new AuthenticateApiKey({
      apiKeys: revokedRepository,
      clock,
    });
    expect(await revokedAuthenticator.execute(revokedToken)).toBeNull();

    const expiredRepository = new MemoryApiKeyRepository();
    const expiredToken = await seedRecord(expiredRepository, {
      expiresAt: new Date("2025-12-31T23:59:59.000Z"),
    });
    const expiredAuthenticator = new AuthenticateApiKey({
      apiKeys: expiredRepository,
      clock,
    });
    expect(await expiredAuthenticator.execute(expiredToken)).toBeNull();
  });

  it("rejects duplicate credential inserts without rotating verification material", async () => {
    const repository = new MemoryApiKeyRepository();
    const token = await seedRecord(repository);
    const original = await repository.findById(apiKeyId);

    await expect(
      repository.create({
        apiKey: ApiKey.create({
          id: apiKeyId,
          workspaceId,
          name: "replacement",
          role: COMMUNITY_EDITION_ROLES.VIEWER,
          now,
        }),
        secretDigest: generateApiKeySecretMaterial(apiKeyId).secretDigest,
      }),
    ).rejects.toBeInstanceOf(DuplicateApiKeyIdError);

    const loaded = await repository.findById(apiKeyId);
    expect(loaded!.secretDigest.equals(original!.secretDigest)).toBe(true);
    expect(loaded!.apiKey.name).toBe("test");
    expect(verifyApiKeySecret(token.split(".")[1]!, loaded!.secretDigest)).toBe(
      true,
    );
  });
});
