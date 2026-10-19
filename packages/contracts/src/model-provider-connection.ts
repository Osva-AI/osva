import type { ModelProvider } from "./model-gateway.js";
import type { SecretReference } from "./secret-reference.js";

/** Immutable endpoint configuration for a provider connection version. */
export interface ModelProviderConnectionEndpoint {
  readonly baseUrl: string;
  readonly allowPrivateNetworks?: boolean;
}

/** Stored configuration for an immutable connection version (internal). */
export interface ModelProviderConnectionVersionConfig {
  readonly endpoint?: ModelProviderConnectionEndpoint;
  readonly credentialRef?: SecretReference;
}

export const MODEL_PROVIDER_CONNECTION_TEST_STATUSES = [
  "READY",
  "FAILED",
] as const;

export type ModelProviderConnectionTestStatus =
  (typeof MODEL_PROVIDER_CONNECTION_TEST_STATUSES)[number];

export function isModelProviderConnectionTestStatus(
  value: string,
): value is ModelProviderConnectionTestStatus {
  return (
    MODEL_PROVIDER_CONNECTION_TEST_STATUSES as readonly string[]
  ).includes(value);
}

export interface ModelProviderConnectionTestResult {
  readonly status: ModelProviderConnectionTestStatus;
  readonly checkedAt: string;
  readonly code?: string;
}

/** Public credential metadata — never exposes secret-reference identifiers. */
export interface PublicModelProviderCredentialV1 {
  readonly configured: true;
}

export interface PublicModelProviderConnectionEndpointV1 {
  readonly baseUrl: string;
  readonly allowPrivateNetworks?: boolean;
}

export function mapModelProviderConnectionVersionToPublicConfig(input: {
  readonly endpoint?: ModelProviderConnectionEndpoint;
  readonly credentialRef?: SecretReference;
}): {
  readonly endpoint?: PublicModelProviderConnectionEndpointV1;
  readonly credential?: PublicModelProviderCredentialV1;
} {
  return {
    ...(input.endpoint === undefined
      ? {}
      : {
          endpoint: {
            baseUrl: input.endpoint.baseUrl,
            ...(input.endpoint.allowPrivateNetworks === undefined
              ? {}
              : {
                  allowPrivateNetworks: input.endpoint.allowPrivateNetworks,
                }),
          },
        }),
    ...(input.credentialRef === undefined
      ? {}
      : { credential: { configured: true as const } }),
  };
}

export function connectionProviderSupportsCustomEndpoint(
  provider: ModelProvider,
): boolean {
  return (
    provider === "OPENAI" ||
    provider === "ANTHROPIC" ||
    provider === "GOOGLE_GEMINI"
  );
}
