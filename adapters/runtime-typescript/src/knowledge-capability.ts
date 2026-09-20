import { randomUUID } from "node:crypto";

import type { JsonObject } from "@osva/contracts";

import { KnowledgeErrorCode, isKnowledgeBindingName } from "./constants.js";
import {
  isParentToChildKnowledgeSearchMessage,
  type KnowledgeSearchRequestMessage,
} from "./protocol.js";

export class KnowledgeCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeCapabilityError";
    this.code = code;
  }
}

export interface KnowledgeSearchOptions {
  readonly topK?: number;
  readonly filter?: JsonObject;
}

export interface TrustedAgentKnowledgeHit {
  readonly knowledgeChunkId: string;
  readonly knowledgeIndexId: string;
  readonly knowledgeSourceId: string;
  readonly artifactReference: {
    readonly type: "artifact";
    readonly artifactId: string;
  };
  readonly text: string;
  readonly score: number;
  readonly location?: {
    readonly page?: number;
    readonly heading?: string;
    readonly sourceSegmentOrdinal?: number;
  };
  readonly attributes: JsonObject;
}

export interface TrustedAgentKnowledge {
  search(
    binding: string,
    query: string,
    options?: KnowledgeSearchOptions,
  ): Promise<readonly TrustedAgentKnowledgeHit[]>;
}

export function createTrustedAgentKnowledge(): TrustedAgentKnowledge {
  const pendingSearches =
    createPendingMap<readonly TrustedAgentKnowledgeHit[]>();

  process.on("message", (raw: unknown) => {
    if (isParentToChildKnowledgeSearchMessage(raw)) {
      dispatchPending(pendingSearches, raw);
    }
  });

  return {
    search(binding, query, options) {
      return requestCapability({
        binding,
        bindingChecker: isKnowledgeBindingName,
        unavailableCode: KnowledgeErrorCode.KNOWLEDGE_UNAVAILABLE,
        buildMessage: (callId): KnowledgeSearchRequestMessage =>
          options?.topK === undefined && options?.filter === undefined
            ? {
                v: 1,
                type: "knowledge.search.request",
                callId,
                binding,
                query,
              }
            : {
                v: 1,
                type: "knowledge.search.request",
                callId,
                binding,
                query,
                ...(options?.topK === undefined ? {} : { topK: options.topK }),
                ...(options?.filter === undefined
                  ? {}
                  : { filter: options.filter }),
              },
        pending: pendingSearches,
      });
    },
  };
}

function createPendingMap<T>() {
  return new Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: KnowledgeCapabilityError) => void;
    }
  >();
}

function dispatchPending<T>(
  pending: Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: KnowledgeCapabilityError) => void;
    }
  >,
  raw: {
    readonly callId: string;
    readonly type: string;
    readonly error?: { readonly code: string; readonly message: string };
    readonly hits?: readonly TrustedAgentKnowledgeHit[];
  },
): void {
  const waiter = pending.get(raw.callId);
  if (waiter === undefined) {
    return;
  }

  pending.delete(raw.callId);
  if (raw.type.endsWith(".succeeded")) {
    waiter.resolve((raw.hits ?? []) as T);
    return;
  }

  waiter.reject(
    new KnowledgeCapabilityError(
      raw.error?.code ?? KnowledgeErrorCode.KNOWLEDGE_UNAVAILABLE,
      raw.error?.message ?? "Knowledge capability failed.",
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
      readonly reject: (error: KnowledgeCapabilityError) => void;
    }
  >;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!options.bindingChecker(options.binding)) {
      reject(
        new KnowledgeCapabilityError(
          KnowledgeErrorCode.KNOWLEDGE_BINDING_NOT_FOUND,
          "Knowledge binding was not found.",
        ),
      );
      return;
    }

    if (typeof process.send !== "function") {
      reject(
        new KnowledgeCapabilityError(
          options.unavailableCode,
          "Knowledge capability is unavailable.",
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
        new KnowledgeCapabilityError(
          options.unavailableCode,
          "Knowledge capability is unavailable.",
        ),
      );
    }
  });
}
