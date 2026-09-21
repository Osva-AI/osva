import type { ApiKeyId } from "@osva/contracts";

import { DomainError } from "./errors.js";

export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super("Authentication is required.");
  }
}

export class PermissionDeniedError extends DomainError {
  constructor() {
    super("Permission denied.");
  }
}

export class DuplicateApiKeyIdError extends DomainError {
  readonly apiKeyId: ApiKeyId;

  constructor(apiKeyId: ApiKeyId) {
    super(`API key '${apiKeyId}' already exists.`);
    this.apiKeyId = apiKeyId;
  }
}

export class ApiKeyNotFoundError extends DomainError {
  readonly apiKeyId: ApiKeyId;

  constructor(apiKeyId: ApiKeyId) {
    super(`API key '${apiKeyId}' was not found.`);
    this.apiKeyId = apiKeyId;
  }
}

export class BootstrapAlreadyCompletedError extends DomainError {
  constructor() {
    super(
      "Installation bootstrap has already completed. Existing API keys were not modified.",
    );
  }
}

export class BootstrapExistingWorkspaceStateError extends DomainError {
  constructor(workspaceCount: number) {
    super(
      workspaceCount === 1
        ? "An existing workspace was detected but no API keys exist. Re-run bootstrap with --workspace-id <id> to create the initial ADMIN API key for that workspace."
        : "Multiple existing workspaces were detected but no API keys exist. Re-run bootstrap with --workspace-id <id> to create the initial ADMIN API key for a specific workspace.",
    );
  }
}
