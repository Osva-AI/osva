import {
  AUTHENTICATION_METHODS,
  AUTHENTICATION_FAILURE_REASONS,
  type ApiKeyId,
  type AuthenticationFailureReason,
  type CommunityEditionRole,
  type ApiKeyRequestPrincipal,
  type WorkspaceId,
} from "@osva-ai/contracts";

import { parseApiKeyToken, verifyApiKeySecret } from "./api-key-credential.js";
import type { ApiKeyRepository } from "./ports/api-key-repository.js";

export interface AuthenticateApiKeyClock {
  now(): Date;
}

export interface AuthenticateApiKeyDependencies {
  readonly apiKeys: ApiKeyRepository;
  readonly clock: AuthenticateApiKeyClock;
}

export class AuthenticateApiKey {
  constructor(private readonly deps: AuthenticateApiKeyDependencies) {}

  async execute(bearerToken: string): Promise<ApiKeyRequestPrincipal | null> {
    const result = await this.executeDetailed(bearerToken);
    return result.outcome === "authenticated" ? result.principal : null;
  }

  async executeDetailed(
    bearerToken: string,
  ): Promise<AuthenticateApiKeyResult> {
    const parsed = parseApiKeyToken(bearerToken);
    if (parsed === null) {
      return {
        outcome: "failed",
        reason: AUTHENTICATION_FAILURE_REASONS.MALFORMED_TOKEN,
      };
    }

    const record = await this.deps.apiKeys.findById(parsed.apiKeyId);
    if (record === null) {
      return {
        outcome: "failed",
        reason: AUTHENTICATION_FAILURE_REASONS.UNKNOWN_KEY,
      };
    }

    const apiKey = record.apiKey;
    if (apiKey.revokedAt !== undefined) {
      return {
        outcome: "failed",
        reason: AUTHENTICATION_FAILURE_REASONS.REVOKED_KEY,
      };
    }

    if (apiKey.isExpired(this.deps.clock.now())) {
      return {
        outcome: "failed",
        reason: AUTHENTICATION_FAILURE_REASONS.EXPIRED_KEY,
      };
    }

    if (!verifyApiKeySecret(parsed.secret, record.secretDigest)) {
      return {
        outcome: "failed",
        reason: AUTHENTICATION_FAILURE_REASONS.INVALID_SECRET,
      };
    }

    return {
      outcome: "authenticated",
      principal: toRequestPrincipal(apiKey.id, apiKey.workspaceId, apiKey.role),
    };
  }
}

export type AuthenticateApiKeyResult =
  | {
      readonly outcome: "authenticated";
      readonly principal: ApiKeyRequestPrincipal;
    }
  | {
      readonly outcome: "failed";
      readonly reason: AuthenticationFailureReason;
    };

export function toRequestPrincipal(
  subjectId: ApiKeyId,
  workspaceId: WorkspaceId,
  role: CommunityEditionRole,
): ApiKeyRequestPrincipal {
  return {
    authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
    subjectId,
    workspaceId,
    role,
  };
}

export {
  generateApiKeySecretMaterial,
  parseApiKeyToken,
  verifyApiKeySecret,
  digestApiKeySecret,
  API_KEY_SECRET_DIGEST_BYTE_LENGTH,
} from "./api-key-credential.js";
