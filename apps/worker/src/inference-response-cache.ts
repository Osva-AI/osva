import {
  ValkeyExactResponseCache,
  createAesGcmWireProtection,
  parseKeyRingFromEnv,
  type ValkeyExactResponseCacheOptions,
} from "@osva/adapters-inference-cache-valkey";
import type { ExactResponseCachePort } from "@osva-ai/contracts";
import type { OsvaInstrumentation } from "@osva/observability";
import { INFERENCE_RESPONSE_CACHE_METRIC } from "@osva/observability";

import type { WorkerConfig } from "./config.js";

export interface InferenceResponseCacheComposeInput {
  readonly config: WorkerConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly instrumentation?: OsvaInstrumentation;
}

export interface InferenceResponseCacheComposeResult {
  readonly port: ExactResponseCachePort;
  readonly close: () => Promise<void>;
}

export function resolveInferenceResponseCacheEnabled(
  env: NodeJS.ProcessEnv,
): boolean {
  const raw = env.OSVA_EXACT_RESPONSE_CACHE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function composeInferenceResponseCache(
  input: InferenceResponseCacheComposeInput,
): InferenceResponseCacheComposeResult | undefined {
  if (!resolveInferenceResponseCacheEnabled(input.env)) {
    return undefined;
  }

  const activeKeyId = readRequired(
    input.env.OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_ID,
    "OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_ID",
  );
  const activeKeyB64 = readRequired(
    input.env.OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_B64,
    "OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_B64",
  );
  const readKeysB64 = parseOptionalReadKeys(
    input.env.OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON,
  );

  const keyRing = parseKeyRingFromEnv({
    activeKeyId,
    activeKeyB64,
    readKeysB64,
  });

  const instrumentation = input.instrumentation;
  const cacheOptions: ValkeyExactResponseCacheOptions = {
    url: input.config.valkeyUrl,
    wireProtection: createAesGcmWireProtection({
      keyRing,
      rejectLegacyPlaintext: true,
    }),
    onCacheEvent: (event) => {
      const attrs: Record<string, string> = { kind: event.kind };
      if (event.reason !== undefined) {
        attrs.reason = event.reason;
      }
      instrumentation?.recordCounter(
        INFERENCE_RESPONSE_CACHE_METRIC.EVENTS,
        1,
        attrs,
      );
    },
  };

  const cache = new ValkeyExactResponseCache(cacheOptions);

  return {
    port: cache,
    close: () => cache.close(),
  };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new Error(
      `${name} is required when OSVA_EXACT_RESPONSE_CACHE_ENABLED is true.`,
    );
  }
  return trimmed;
}

function parseOptionalReadKeys(
  raw: string | undefined,
): Readonly<Record<string, string>> | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON must be valid JSON object.",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON must be a JSON object.",
    );
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        "OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON values must be non-empty strings.",
      );
    }
    out[key] = value.trim();
  }
  return out;
}
