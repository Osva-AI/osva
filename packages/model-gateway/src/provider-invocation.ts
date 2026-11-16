import { MODEL_PROVIDER_MODEL_ID_MAX_LENGTH } from "@osva-ai/contracts";

import type { ProviderGenerateTextInvocation } from "./usage.js";

const SAFE_PROVIDER_MODEL_ID = /^[A-Za-z0-9_.:/@-]{1,256}$/;
const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function sanitizeProviderModelId(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
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

export function sanitizeProviderRequestId(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return undefined;
  }

  if (!SAFE_PROVIDER_TOKEN.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

export function buildProviderInvocationMetadata(
  configuredProviderModelId: string,
  providerReportedModelId: string | undefined,
): ProviderGenerateTextInvocation {
  return {
    configuredProviderModelId,
    ...(providerReportedModelId !== undefined
      ? { providerReportedModelId }
      : {}),
  };
}
