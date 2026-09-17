import type {
  MemoryAuthorization,
  MemoryDeleteRequest,
  MemoryGateway as MemoryGatewayPort,
  MemoryGetRequest,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecordView,
  MemorySetRequest,
} from "@osva/contracts";
import { isCanonicalJsonValue, MEMORY_ERROR_CODES } from "@osva/contracts";
import {
  MemoryNamespaceNotFoundError,
  MemoryRecordConflictError,
  MemoryRecordNotFoundError,
  type MemoryNamespaceRepository,
} from "@osva/domain";

import { MemoryGatewayError, memoryGatewayError } from "./errors.js";

export interface MemoryGatewayClock {
  now(): Date;
}

export interface MemoryGatewayDependencies {
  readonly memoryNamespaces: MemoryNamespaceRepository;
  readonly clock?: MemoryGatewayClock;
}

export class MemoryGateway implements MemoryGatewayPort {
  private readonly clock: MemoryGatewayClock;

  constructor(private readonly deps: MemoryGatewayDependencies) {
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    const binding = await resolveBinding(
      request.bindingName,
      authorization,
      this.deps.memoryNamespaces,
    );

    try {
      const record = await this.deps.memoryNamespaces.getRecord(
        binding.namespaceId,
        request.key,
      );
      if (record === null) {
        throw memoryGatewayError(
          MEMORY_ERROR_CODES.MEMORY_KEY_NOT_FOUND,
          "Memory key was not found.",
        );
      }

      return {
        key: record.key,
        value: record.value,
        revision: record.revision,
      };
    } catch (error) {
      throw mapDomainError(error);
    }
  }

  async set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    assertPersistentMutationAllowed(authorization);
    const binding = await resolveBinding(
      request.bindingName,
      authorization,
      this.deps.memoryNamespaces,
    );
    assertWriteAccess(binding.access);

    if (!isCanonicalJsonValue(request.value)) {
      throw memoryGatewayError(
        MEMORY_ERROR_CODES.MEMORY_INVALID_VALUE,
        "Memory value must be JSON-compatible.",
      );
    }

    try {
      const record = await this.deps.memoryNamespaces.setRecord({
        namespaceId: binding.namespaceId,
        key: request.key,
        value: request.value,
        expectedRevision: request.expectedRevision,
        updatedAt: this.clock.now(),
      });

      return {
        key: record.key,
        value: record.value,
        revision: record.revision,
      };
    } catch (error) {
      throw mapDomainError(error);
    }
  }

  async delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void> {
    assertPersistentMutationAllowed(authorization);
    const binding = await resolveBinding(
      request.bindingName,
      authorization,
      this.deps.memoryNamespaces,
    );
    assertWriteAccess(binding.access);

    try {
      await this.deps.memoryNamespaces.deleteRecord({
        namespaceId: binding.namespaceId,
        key: request.key,
        expectedRevision: request.expectedRevision,
      });
    } catch (error) {
      throw mapDomainError(error);
    }
  }

  async list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult> {
    const binding = await resolveBinding(
      request.bindingName,
      authorization,
      this.deps.memoryNamespaces,
    );
    const limit = clampListLimit(request.limit);

    try {
      const page = await this.deps.memoryNamespaces.listRecords({
        namespaceId: binding.namespaceId,
        prefix: request.prefix,
        limit,
        cursor: request.cursor,
      });

      return {
        items: page.records.map((record) => ({
          key: record.key,
          value: record.value,
          revision: record.revision,
        })),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      throw mapDomainError(error);
    }
  }
}

async function resolveBinding(
  bindingName: string,
  authorization: MemoryAuthorization,
  memoryNamespaces: MemoryNamespaceRepository,
) {
  const binding = authorization.memoryNamespaceBindings[bindingName];
  if (binding === undefined) {
    throw memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_BINDING_NOT_FOUND,
      "Memory binding was not found.",
    );
  }

  const namespace = await memoryNamespaces.findNamespaceById(
    binding.namespaceId,
  );
  if (
    namespace === null ||
    namespace.workspaceId !== authorization.workspaceId
  ) {
    throw memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_BINDING_NOT_FOUND,
      "Memory binding was not found.",
    );
  }

  return binding;
}

function assertWriteAccess(access: "READ_ONLY" | "READ_WRITE"): void {
  if (access !== "READ_WRITE") {
    throw memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_PERMISSION_DENIED,
      "Memory binding is read-only.",
    );
  }
}

function assertPersistentMutationAllowed(
  authorization: MemoryAuthorization,
): void {
  if (!authorization.allowPersistentMutation) {
    throw memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_PERMISSION_DENIED,
      "Persistent memory mutation is not allowed for this execution.",
    );
  }
}

function clampListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  return Math.min(Math.max(limit, 1), 100);
}

function mapDomainError(error: unknown): MemoryGatewayError {
  if (error instanceof MemoryGatewayError) {
    return error;
  }

  if (error instanceof MemoryRecordNotFoundError) {
    return memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_KEY_NOT_FOUND,
      error.message,
    );
  }

  if (error instanceof MemoryRecordConflictError) {
    return memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_CONFLICT,
      error.message,
    );
  }

  if (error instanceof MemoryNamespaceNotFoundError) {
    return memoryGatewayError(
      MEMORY_ERROR_CODES.MEMORY_BINDING_NOT_FOUND,
      error.message,
    );
  }

  return memoryGatewayError(
    MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
    error instanceof Error ? error.message : "Memory operation failed.",
  );
}
