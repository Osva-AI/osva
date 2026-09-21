import type { CommunityEditionRole, WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import type { ApiKeyRepository } from "@osva/domain";
import {
  ApiKey as ApiKeyEntity,
  AuthenticateApiKey,
  generateApiKeySecretMaterial,
} from "@osva/domain";
import type { ApiKeyId } from "@osva/contracts";

import type { WebSecurityServices } from "./http-security.js";
import { createWebSecurityServices } from "./web-security-services.js";

export interface TestApiKeyRecord {
  readonly apiKeyId: ApiKeyId;
  readonly plaintextToken: string;
  readonly role: CommunityEditionRole;
  readonly workspaceId: WorkspaceId;
}

export async function seedTestApiKey(options: {
  readonly apiKeys: ApiKeyRepository;
  readonly workspaceId: WorkspaceId;
  readonly role?: CommunityEditionRole;
  readonly apiKeyId?: ApiKeyId;
  readonly now?: Date;
}): Promise<TestApiKeyRecord> {
  const now = options.now ?? new Date("2026-01-15T12:00:00.000Z");
  const apiKeyId =
    options.apiKeyId ?? (`ak-${options.workspaceId}` as ApiKeyId);
  const apiKey = ApiKeyEntity.create({
    id: apiKeyId,
    workspaceId: options.workspaceId,
    name: "test-key",
    role: options.role ?? COMMUNITY_EDITION_ROLES.ADMIN,
    now,
  });
  const secretMaterial = generateApiKeySecretMaterial(apiKeyId);
  await options.apiKeys.create({
    apiKey,
    secretDigest: secretMaterial.secretDigest,
  });

  return {
    apiKeyId,
    plaintextToken: secretMaterial.plaintextToken,
    role: apiKey.role,
    workspaceId: options.workspaceId,
  };
}

export function createTestWebSecurityServices(
  authenticateApiKey: AuthenticateApiKey,
): WebSecurityServices {
  return createWebSecurityServices(authenticateApiKey);
}

export function authorizationHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
