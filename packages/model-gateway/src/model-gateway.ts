import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  ModelGateway as ModelGatewayPort,
  ModelProvider,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES, isModelFinishReason } from "@osva-ai/contracts";
import {
  generateCompletionInputSchema,
  generateTextInputSchema,
} from "@osva-ai/contracts/schemas";
import type { ModelProfileRepository } from "@osva/domain";

import { ModelGatewayError } from "./errors.js";
import type {
  ModelGatewayGenerateTextOptions,
  ModelProviderAdapter,
} from "./provider-adapter.js";

export interface ModelProviderConnectionResolverPort {
  resolveForModelProfileVersion(input: {
    readonly modelProfileId: import("@osva-ai/contracts").ModelProfileId;
    readonly modelProviderConnectionVersionId:
      import("@osva-ai/contracts").ModelProviderConnectionVersionId | undefined;
    readonly provider: ModelProvider;
  }): Promise<ModelProviderAdapter>;
}
import type { ProviderGenerateTextResult } from "./usage.js";

export interface ModelGatewayDependencies {
  readonly modelProfiles: ModelProfileRepository;
  readonly providers: Readonly<
    Partial<Record<ModelProvider, ModelProviderAdapter>>
  >;
  readonly connectionResolver?: ModelProviderConnectionResolverPort;
}

/**
 * Provider-neutral Stage 1 ModelGateway.
 *
 * Loads an immutable ModelProfileVersion and routes generateText to the
 * matching provider adapter. It does not own Run lifecycle persistence.
 * AbortSignal is an internal execution option, not part of GenerateTextRequest.
 */
export class ModelGateway implements ModelGatewayPort {
  constructor(private readonly deps: ModelGatewayDependencies) {}

  async generateText(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<GenerateTextResult> {
    const outcome = await this.generateTextOutcome(request, options);
    if (outcome.text === undefined || outcome.text.trim().length === 0) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned no textual output.",
      );
    }
    return { text: outcome.text };
  }

  async generateCompletion(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<GenerateCompletionResult> {
    const outcome = await this.generateCompletionOutcome(request, options);
    const finishReason =
      outcome.finishReason !== undefined &&
      isModelFinishReason(outcome.finishReason)
        ? outcome.finishReason
        : "other";

    return {
      text: outcome.text,
      toolCalls: outcome.toolCalls ?? [],
      finishReason,
    };
  }

  async generateTextOutcome(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    const parsed = generateTextInputSchema.safeParse({
      messages: request.messages,
      maxOutputTokens: request.maxOutputTokens,
    });
    if (!parsed.success) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "Model generateText request is invalid.",
      );
    }

    return this.invokeProviderGenerate({
      modelProfileVersionId: request.modelProfileVersionId,
      messages: parsed.data.messages,
      maxOutputTokens: parsed.data.maxOutputTokens,
      signal: options?.signal,
    });
  }

  async generateCompletionOutcome(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    const parsed = generateCompletionInputSchema.safeParse({
      messages: request.messages,
      maxOutputTokens: request.maxOutputTokens,
      toolDefinitions: request.toolDefinitions,
      jsonSchema: request.jsonSchema,
    });
    if (!parsed.success) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "Model generateCompletion request is invalid.",
      );
    }

    return this.invokeProviderGenerate({
      modelProfileVersionId: request.modelProfileVersionId,
      messages: parsed.data.messages,
      maxOutputTokens: parsed.data.maxOutputTokens,
      toolDefinitions: parsed.data.toolDefinitions,
      jsonSchema: parsed.data.jsonSchema,
      signal: options?.signal,
    });
  }

  private async invokeProviderGenerate(input: {
    readonly modelProfileVersionId: GenerateTextRequest["modelProfileVersionId"];
    readonly messages: GenerateCompletionRequest["messages"];
    readonly maxOutputTokens?: number;
    readonly toolDefinitions?: GenerateCompletionRequest["toolDefinitions"];
    readonly jsonSchema?: GenerateCompletionRequest["jsonSchema"];
    readonly signal?: AbortSignal;
  }): Promise<ProviderGenerateTextResult> {
    if (!input.modelProfileVersionId) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
        "ModelProfileVersion was not found.",
      );
    }

    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      input.modelProfileVersionId,
    );
    if (version === null) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
        "ModelProfileVersion was not found.",
      );
    }

    const adapter =
      this.deps.connectionResolver === undefined
        ? this.deps.providers[version.provider]
        : await this.deps.connectionResolver.resolveForModelProfileVersion({
            modelProfileId: version.modelProfileId,
            modelProviderConnectionVersionId:
              version.modelProviderConnectionVersionId,
            provider: version.provider,
          });

    if (adapter === undefined) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider is unavailable.",
      );
    }

    return adapter.generateText({
      model: version.model,
      messages: input.messages,
      maxOutputTokens: input.maxOutputTokens,
      toolDefinitions: input.toolDefinitions,
      jsonSchema: input.jsonSchema,
      signal: input.signal,
    });
  }
}
