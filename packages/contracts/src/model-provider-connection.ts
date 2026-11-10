import type { ModelProvider } from "./model-gateway.js";
import type { SecretReference } from "./secret-reference.js";

/** Anthropic Console workspace id (`wrkspc_…`) for identity-linked / multi-workspace API keys. */
export const ANTHROPIC_PROVIDER_WORKSPACE_ID_PATTERN =
  /^wrkspc_[A-Za-z0-9]{1,128}$/;

export function isAnthropicProviderWorkspaceId(value: string): boolean {
  return ANTHROPIC_PROVIDER_WORKSPACE_ID_PATTERN.test(value.trim());
}

/** Immutable endpoint configuration for a provider connection version. */
export interface ModelProviderConnectionEndpoint {
  readonly baseUrl: string;
  readonly allowPrivateNetworks?: boolean;
  /**
   * Anthropic provider workspace for keys that are not scoped to one workspace.
   * Bound to the connection version; never inferred from OSVA workspace id.
   */
  readonly anthropicWorkspaceId?: string;
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
  readonly anthropicWorkspaceId?: string;
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
            ...(input.endpoint.anthropicWorkspaceId === undefined
              ? {}
              : {
                  anthropicWorkspaceId: input.endpoint.anthropicWorkspaceId,
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
