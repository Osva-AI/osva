import type { ApiKeyId, WorkspaceId } from "./ids.js";

export const AUTHENTICATION_METHODS = {
  API_KEY: "API_KEY",
} as const;

export type AuthenticationMethod =
  (typeof AUTHENTICATION_METHODS)[keyof typeof AUTHENTICATION_METHODS];

export const COMMUNITY_EDITION_ROLES = {
  VIEWER: "VIEWER",
  OPERATOR: "OPERATOR",
  EDITOR: "EDITOR",
  ADMIN: "ADMIN",
} as const;

export type CommunityEditionRole =
  (typeof COMMUNITY_EDITION_ROLES)[keyof typeof COMMUNITY_EDITION_ROLES];

export const AUTHORIZATION_ACTIONS = {
  READ: "READ",
  EXECUTE: "EXECUTE",
  WRITE: "WRITE",
  ADMIN: "ADMIN",
} as const;

export type AuthorizationAction =
  (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS];

export const PUBLIC_API_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
} as const;

/** Default maximum JSON request body size for ordinary REST handlers (1 MiB). */
export const OSVA_DEFAULT_JSON_BODY_MAX_BYTES = 1_048_576;

export type PublicApiErrorCode =
  (typeof PUBLIC_API_ERROR_CODES)[keyof typeof PUBLIC_API_ERROR_CODES];

export const AUTHENTICATION_FAILURE_REASONS = {
  MALFORMED_TOKEN: "malformed_token",
  UNKNOWN_KEY: "unknown_key",
  REVOKED_KEY: "revoked_key",
  EXPIRED_KEY: "expired_key",
  INVALID_SECRET: "invalid_secret",
} as const;

export type AuthenticationFailureReason =
  (typeof AUTHENTICATION_FAILURE_REASONS)[keyof typeof AUTHENTICATION_FAILURE_REASONS];

export interface RequestPrincipal {
  readonly subjectId: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly role: CommunityEditionRole;
  readonly authenticationMethod: AuthenticationMethod;
}

export interface AuthContextResourceV1 {
  readonly subjectId: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly role: CommunityEditionRole;
}

export const API_KEY_NAME_MAX_LENGTH = 128;

export const OSVA_REQUEST_ID_HEADER = "x-osva-request-id";
