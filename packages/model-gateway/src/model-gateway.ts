import type {
  GenerateTextRequest,
  GenerateTextResult,
  ModelGateway as ModelGatewayPort,
  ModelProvider,
} from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";
import { generateTextInputSchema } from "@osva/contracts/schemas";
import type { ModelProfileRepository } from "@osva/domain";

import { ModelGatewayError } from "./errors.js";
import type {
  ModelGatewayGenerateTextOptions,
  ModelProviderAdapter,
} from "./provider-adapter.js";

export interface ModelGatewayDependencies {
  readonly modelProfiles: ModelProfileRepository;
  readonly providers: Readonly<
    Partial<Record<ModelProvider, ModelProviderAdapter>>
  >;
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

    if (!request.modelProfileVersionId) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
        "ModelProfileVersion was not found.",
      );
    }

    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      request.modelProfileVersionId,
    );
    if (version === null) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROFILE_VERSION_NOT_FOUND,
        "ModelProfileVersion was not found.",
      );
    }

    const adapter = this.deps.providers[version.provider];
    if (adapter === undefined) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider is unavailable.",
      );
    }

    return adapter.generateText({
      model: version.model,
      messages: parsed.data.messages,
      maxOutputTokens: parsed.data.maxOutputTokens,
      signal: options?.signal,
    });
  }
}
