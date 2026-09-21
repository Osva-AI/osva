import type {
  ApiKeyId,
  CommunityEditionRole,
  WorkspaceId,
} from "@osva/contracts";
import { API_KEY_NAME_MAX_LENGTH } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface ApiKeyProps {
  readonly id: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly role: CommunityEditionRole;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly revokedAt?: Date;
}

export interface CreateApiKeyProps {
  readonly id: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly role: CommunityEditionRole;
  readonly now: Date;
  readonly expiresAt?: Date;
}

export class ApiKey {
  readonly id: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly role: CommunityEditionRole;
  readonly createdAt: Date;
  readonly expiresAt: Date | undefined;
  readonly revokedAt: Date | undefined;

  private constructor(props: ApiKeyProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.name = props.name;
    this.role = props.role;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
    this.revokedAt = props.revokedAt;
  }

  static create(props: CreateApiKeyProps): ApiKey {
    if (!props.id) {
      throw new DomainInvariantError("ApiKey.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("ApiKey.workspaceId is required.");
    }

    validateApiKeyName(props.name);

    return Object.freeze(
      new ApiKey({
        id: props.id,
        workspaceId: props.workspaceId,
        name: props.name.trim(),
        role: props.role,
        createdAt: copyInstant(props.now),
        expiresAt:
          props.expiresAt === undefined
            ? undefined
            : copyInstant(props.expiresAt),
        revokedAt: undefined,
      }),
    );
  }

  static rehydrate(props: ApiKeyProps): ApiKey {
    return Object.freeze(
      new ApiKey({
        id: props.id,
        workspaceId: props.workspaceId,
        name: props.name,
        role: props.role,
        createdAt: copyInstant(props.createdAt),
        expiresAt:
          props.expiresAt === undefined
            ? undefined
            : copyInstant(props.expiresAt),
        revokedAt:
          props.revokedAt === undefined
            ? undefined
            : copyInstant(props.revokedAt),
      }),
    );
  }

  revoke(now: Date): ApiKey {
    if (this.revokedAt !== undefined) {
      return this;
    }

    return ApiKey.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      name: this.name,
      role: this.role,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      revokedAt: copyInstant(now),
    });
  }

  isExpired(at: Date): boolean {
    return (
      this.expiresAt !== undefined && this.expiresAt.getTime() <= at.getTime()
    );
  }
}

export function validateApiKeyName(name: string): string {
  const trimmed = requireNonEmptyString(name, "ApiKey.name").trim();
  if (trimmed.length > API_KEY_NAME_MAX_LENGTH) {
    throw new DomainInvariantError(
      `ApiKey.name must be at most ${String(API_KEY_NAME_MAX_LENGTH)} characters.`,
    );
  }

  return trimmed;
}
