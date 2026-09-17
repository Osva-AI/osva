import { randomUUID } from "node:crypto";

import type { JsonValue } from "@osva/contracts";

import { MemoryErrorCode, isMemoryBindingName } from "./constants.js";
import {
  isParentToChildMemoryDeleteMessage,
  isParentToChildMemoryGetMessage,
  isParentToChildMemoryListMessage,
  isParentToChildMemorySetMessage,
  type MemoryDeleteRequestMessage,
  type MemoryGetRequestMessage,
  type MemoryListRequestMessage,
  type MemorySetRequestMessage,
} from "./protocol.js";

export class MemoryCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryCapabilityError";
    this.code = code;
  }
}

export interface MemoryRecordView {
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
}

export interface MemoryListResult {
  readonly items: readonly MemoryRecordView[];
  readonly nextCursor?: string;
}

export interface MemorySetOptions {
  readonly expectedRevision?: number;
}

export interface MemoryDeleteOptions {
  readonly expectedRevision?: number;
}

export interface MemoryListOptions {
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface TrustedAgentMemory {
  get(binding: string, key: string): Promise<MemoryRecordView>;
  set(
    binding: string,
    key: string,
    value: JsonValue,
    options?: MemorySetOptions,
  ): Promise<MemoryRecordView>;
  delete(
    binding: string,
    key: string,
    options?: MemoryDeleteOptions,
  ): Promise<void>;
  list(binding: string, options?: MemoryListOptions): Promise<MemoryListResult>;
}

export function createTrustedAgentMemory(): TrustedAgentMemory {
  const pendingGets = createPendingMap<MemoryRecordView>();
  const pendingSets = createPendingMap<MemoryRecordView>();
  const pendingDeletes = createPendingMap<void>();
  const pendingLists = createPendingMap<MemoryListResult>();

  process.on("message", (raw: unknown) => {
    if (isParentToChildMemoryGetMessage(raw)) {
      dispatchPending(pendingGets, raw);
      return;
    }

    if (isParentToChildMemorySetMessage(raw)) {
      dispatchPending(pendingSets, raw);
      return;
    }

    if (isParentToChildMemoryDeleteMessage(raw)) {
      dispatchPending(pendingDeletes, raw);
      return;
    }

    if (isParentToChildMemoryListMessage(raw)) {
      dispatchPending(pendingLists, raw);
    }
  });

  return {
    get(binding, key) {
      return requestCapability({
        binding,
        bindingChecker: isMemoryBindingName,
        unavailableCode: MemoryErrorCode.MEMORY_UNAVAILABLE,
        buildMessage: (callId): MemoryGetRequestMessage => ({
          v: 1,
          type: "memory.get.request",
          callId,
          binding,
          key,
        }),
        pending: pendingGets,
      });
    },
    set(binding, key, value, options) {
      return requestCapability({
        binding,
        bindingChecker: isMemoryBindingName,
        unavailableCode: MemoryErrorCode.MEMORY_UNAVAILABLE,
        buildMessage: (callId): MemorySetRequestMessage =>
          options?.expectedRevision === undefined
            ? {
                v: 1,
                type: "memory.set.request",
                callId,
                binding,
                key,
                value,
              }
            : {
                v: 1,
                type: "memory.set.request",
                callId,
                binding,
                key,
                value,
                expectedRevision: options.expectedRevision,
              },
        pending: pendingSets,
      });
    },
    delete(binding, key, options) {
      return requestCapability({
        binding,
        bindingChecker: isMemoryBindingName,
        unavailableCode: MemoryErrorCode.MEMORY_UNAVAILABLE,
        buildMessage: (callId): MemoryDeleteRequestMessage =>
          options?.expectedRevision === undefined
            ? {
                v: 1,
                type: "memory.delete.request",
                callId,
                binding,
                key,
              }
            : {
                v: 1,
                type: "memory.delete.request",
                callId,
                binding,
                key,
                expectedRevision: options.expectedRevision,
              },
        pending: pendingDeletes,
      });
    },
    list(binding, options) {
      return requestCapability({
        binding,
        bindingChecker: isMemoryBindingName,
        unavailableCode: MemoryErrorCode.MEMORY_UNAVAILABLE,
        buildMessage: (callId): MemoryListRequestMessage => ({
          v: 1,
          type: "memory.list.request",
          callId,
          binding,
          ...(options?.prefix === undefined ? {} : { prefix: options.prefix }),
          ...(options?.limit === undefined ? {} : { limit: options.limit }),
          ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
        }),
        pending: pendingLists,
      });
    },
  };
}

function createPendingMap<T>() {
  return new Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: MemoryCapabilityError) => void;
    }
  >();
}

function dispatchPending<T>(
  pending: Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: MemoryCapabilityError) => void;
    }
  >,
  raw: {
    readonly callId: string;
    readonly type: string;
    readonly error?: { readonly code: string; readonly message: string };
    readonly record?: MemoryRecordView;
    readonly items?: readonly MemoryRecordView[];
    readonly nextCursor?: string;
  },
): void {
  const waiter = pending.get(raw.callId);
  if (waiter === undefined) {
    return;
  }

  pending.delete(raw.callId);
  if (raw.type.endsWith(".succeeded")) {
    if (raw.type === "memory.list.succeeded") {
      waiter.resolve({
        items: raw.items ?? [],
        nextCursor: raw.nextCursor,
      } as T);
      return;
    }

    if (raw.type === "memory.delete.succeeded") {
      waiter.resolve(undefined as T);
      return;
    }

    if (raw.record !== undefined) {
      waiter.resolve(raw.record as T);
    }

    return;
  }

  waiter.reject(
    new MemoryCapabilityError(
      raw.error?.code ?? MemoryErrorCode.MEMORY_UNAVAILABLE,
      raw.error?.message ?? "Memory capability failed.",
    ),
  );
}

function requestCapability<T>(options: {
  readonly binding: string;
  readonly bindingChecker: (value: string) => boolean;
  readonly unavailableCode: string;
  readonly buildMessage: (callId: string) => unknown;
  readonly pending: Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: MemoryCapabilityError) => void;
    }
  >;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!options.bindingChecker(options.binding)) {
      reject(
        new MemoryCapabilityError(
          MemoryErrorCode.MEMORY_BINDING_NOT_FOUND,
          "Memory binding was not found.",
        ),
      );
      return;
    }

    if (typeof process.send !== "function") {
      reject(
        new MemoryCapabilityError(
          options.unavailableCode,
          "Memory capability is unavailable.",
        ),
      );
      return;
    }

    const callId = randomUUID();
    options.pending.set(callId, { resolve, reject });
    const sent = process.send(options.buildMessage(callId));
    if (!sent) {
      options.pending.delete(callId);
      reject(
        new MemoryCapabilityError(
          options.unavailableCode,
          "Memory capability is unavailable.",
        ),
      );
    }
  });
}
