import { AnthropicProviderAdapter } from "@osva/adapters-model-anthropic";
import { GeminiProviderAdapter } from "@osva/adapters-model-gemini";
import { OpenAIProviderAdapter } from "@osva/adapters-model-openai";
import type {
  ModelProfileId,
  ModelProvider,
  ModelProviderConnectionEndpoint,
  ModelProviderConnectionVersionId,
  SecretReference,
  SecretResolver,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import type {
  ModelProviderConnection,
  ModelProviderConnectionRepository,
  ModelProviderConnectionVersion,
  ModelProfileRepository,
} from "@osva/domain";
import {
  ModelGatewayError,
  type ModelProviderAdapter,
} from "@osva/model-gateway";
import {
  createPinnedOutboundFetch,
  evaluateRemoteHttpDestination,
} from "@osva/outbound-network";

export const CONNECTION_TEST_TIMEOUT_MS = 15_000;
const CONNECTION_GENERATE_TIMEOUT_MS = 120_000;

export interface ModelProviderConnectionResolutionPolicy {
  readonly envApiKeys: Partial<Record<ModelProvider, string | undefined>>;
}

export interface ModelProviderConnectionResolverDependencies {
  readonly connections: ModelProviderConnectionRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly secretResolver: SecretResolver;
  readonly legacyProviders: Partial<
    Record<ModelProvider, ModelProviderAdapter>
  >;
  readonly policy: ModelProviderConnectionResolutionPolicy;
}

export class ModelProviderConnectionResolver {
  constructor(
    private readonly deps: ModelProviderConnectionResolverDependencies,
  ) {}

  async resolveForModelProfileVersion(input: {
    readonly modelProfileId: ModelProfileId;
    readonly modelProviderConnectionVersionId:
      ModelProviderConnectionVersionId | undefined;
    readonly provider: ModelProvider;
  }): Promise<ModelProviderAdapter> {
    if (input.modelProviderConnectionVersionId === undefined) {
      return this.legacyAdapter(input.provider);
    }

    const profile = await this.deps.modelProfiles.findModelProfileById(
      input.modelProfileId,
    );
    if (profile === null) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
        "ModelProfileVersion was not found.",
      );
    }

    const connectionVersion =
      await this.deps.connections.findConnectionVersionById(
        input.modelProviderConnectionVersionId,
      );
    if (connectionVersion === null) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider connection is unavailable.",
      );
    }

    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        profile.workspaceId,
        connectionVersion.connectionId,
      );
    if (connection === null) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider connection is unavailable.",
      );
    }

    if (connection.provider !== input.provider) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider connection is unavailable.",
      );
    }

    return this.buildAdapter(connection, connectionVersion);
  }

  async testConnection(input: {
    readonly connection: ModelProviderConnection;
    readonly version: ModelProviderConnectionVersion;
    readonly model: string;
  }): Promise<{
    readonly status: "READY" | "FAILED";
    readonly checkedAt: string;
    readonly code?: string;
  }> {
    const checkedAt = new Date().toISOString();
    const model = input.model.trim();
    if (model.length === 0) {
      return {
        status: "FAILED",
        checkedAt,
        code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      };
    }

    try {
      const adapter = await this.buildAdapter(input.connection, input.version);
      await adapter.generateText({
        model,
        messages: [{ role: "user", content: "ping" }],
        maxOutputTokens: 1,
        signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
      });
      return { status: "READY", checkedAt };
    } catch (error) {
      const code =
        error instanceof ModelGatewayError
          ? error.code
          : MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE;
      return { status: "FAILED", checkedAt, code };
    }
  }

  private legacyAdapter(provider: ModelProvider): ModelProviderAdapter {
    const adapter = this.deps.legacyProviders[provider];
    if (adapter === undefined) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider is unavailable.",
      );
    }

    return adapter;
  }

  private async buildAdapter(
    connection: ModelProviderConnection,
    version: ModelProviderConnectionVersion,
  ): Promise<ModelProviderAdapter> {
    const apiKey = await this.resolveApiKey(
      connection.provider,
      version.credentialRef,
    );
    const endpoint = version.endpoint;
    const fetchImpl =
      endpoint === undefined
        ? undefined
        : await this.createOutboundFetch(endpoint);

    switch (connection.provider) {
      case "OPENAI":
        return new OpenAIProviderAdapter({
          apiKey,
          baseURL: endpoint?.baseUrl,
          fetch: fetchImpl,
          timeout: CONNECTION_GENERATE_TIMEOUT_MS,
        });
      case "ANTHROPIC":
        return new AnthropicProviderAdapter({
          apiKey,
          baseURL: endpoint?.baseUrl,
          fetch: fetchImpl,
          timeout: CONNECTION_GENERATE_TIMEOUT_MS,
        });
      case "GOOGLE_GEMINI":
        return new GeminiProviderAdapter({
          apiKey,
          baseURL: endpoint?.baseUrl,
          fetch: fetchImpl,
          timeout: CONNECTION_GENERATE_TIMEOUT_MS,
        });
      default:
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
          "The configured model provider is unavailable.",
        );
    }
  }

  private async resolveApiKey(
    provider: ModelProvider,
    credentialRef: SecretReference | undefined,
  ): Promise<string> {
    if (credentialRef !== undefined) {
      try {
        const resolved = await this.deps.secretResolver.resolve(credentialRef);
        if (resolved.trim().length === 0) {
          throw new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
            "Model provider credentials are not configured.",
          );
        }

        return resolved;
      } catch {
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
          "Model provider credentials are not configured.",
        );
      }
    }

    const envKey = this.deps.policy.envApiKeys[provider]?.trim();
    if (envKey === undefined || envKey.length === 0) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
        "Model provider credentials are not configured.",
      );
    }

    return envKey;
  }

  private async createOutboundFetch(
    endpoint: ModelProviderConnectionEndpoint,
  ): Promise<typeof fetch> {
    const decision = await evaluateRemoteHttpDestination(endpoint.baseUrl, {
      allowPrivateNetworks: endpoint.allowPrivateNetworks === true,
    });
    if (decision !== "allowed") {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider endpoint is not allowed.",
      );
    }

    return createPinnedOutboundFetch({
      allowPrivateNetworks: endpoint.allowPrivateNetworks === true,
    });
  }
}
