import { MODEL_PROVIDER_MODEL_ID_MAX_LENGTH } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";

const SAFE_PROVIDER_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_PROVIDER_MODEL_ID = /^[A-Za-z0-9_.:/@-]{1,256}$/;

export interface ModelRunStepUsageFinalizeInput {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly usageIncomplete?: boolean;
}

export function sanitizePersistedProviderModelId(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MODEL_PROVIDER_MODEL_ID_MAX_LENGTH ||
    !SAFE_PROVIDER_MODEL_ID.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

export function sanitizePersistedProviderRequestId(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || !SAFE_PROVIDER_REQUEST_ID.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

export function assertModelRunStepUsageInvariants(
  usage: ModelRunStepUsageFinalizeInput,
): void {
  const cached = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;

  if (usage.inputTokens !== undefined) {
    if (cached + cacheWrite > usage.inputTokens) {
      throw new DomainInvariantError(
        "MODEL RunStep cache token breakdown exceeds input tokens.",
      );
    }
  }

  if (usage.usageIncomplete === false && usage.inputTokens === undefined) {
    throw new DomainInvariantError(
      "Complete MODEL RunStep usage requires inputTokens.",
    );
  }
}
