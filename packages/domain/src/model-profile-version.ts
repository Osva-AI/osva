import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProfileVersionPricing,
  ModelProvider,
} from "@osva/contracts";
import {
  isModelPricingCurrency,
  isModelProvider,
  MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  deepFreeze,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requirePositiveInteger,
} from "./internals.js";

export interface ModelProfileVersionProps {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly pricing?: ModelProfileVersionPricing;
  readonly createdAt: Date;
}

export class ModelProfileVersion {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly pricing: ModelProfileVersionPricing | undefined;
  readonly createdAt: Date;

  private constructor(props: ModelProfileVersionProps) {
    this.id = props.id;
    this.modelProfileId = props.modelProfileId;
    this.version = props.version;
    this.provider = props.provider;
    this.model = props.model;
    this.pricing = props.pricing;
    this.createdAt = props.createdAt;
  }

  static create(props: ModelProfileVersionProps): ModelProfileVersion {
    if (!props.id) {
      throw new DomainInvariantError("ModelProfileVersion.id is required.");
    }

    if (!props.modelProfileId) {
      throw new DomainInvariantError(
        "ModelProfileVersion.modelProfileId is required.",
      );
    }

    if (!isModelProvider(props.provider)) {
      throw new DomainInvariantError(
        "ModelProfileVersion.provider must be a supported provider.",
      );
    }

    const pricing =
      props.pricing === undefined ? undefined : validatePricing(props.pricing);

    return Object.freeze(
      new ModelProfileVersion({
        id: props.id,
        modelProfileId: props.modelProfileId,
        version: requirePositiveInteger(
          props.version,
          "ModelProfileVersion.version",
        ),
        provider: props.provider,
        model: requireNonEmptyString(props.model, "ModelProfileVersion.model"),
        pricing,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}

function validatePricing(
  pricing: ModelProfileVersionPricing,
): ModelProfileVersionPricing {
  if (!isModelPricingCurrency(pricing.currency)) {
    throw new DomainInvariantError(
      "ModelProfileVersion.pricing.currency must be USD.",
    );
  }

  const inputUsdMicrosPerMillionTokens = requireNonNegativeInteger(
    pricing.inputUsdMicrosPerMillionTokens,
    "ModelProfileVersion.pricing.inputUsdMicrosPerMillionTokens",
  );
  const outputUsdMicrosPerMillionTokens = requireNonNegativeInteger(
    pricing.outputUsdMicrosPerMillionTokens,
    "ModelProfileVersion.pricing.outputUsdMicrosPerMillionTokens",
  );

  if (
    inputUsdMicrosPerMillionTokens >
      MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS ||
    outputUsdMicrosPerMillionTokens >
      MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS
  ) {
    throw new DomainInvariantError(
      "ModelProfileVersion.pricing rates exceed supported bounds.",
    );
  }

  return deepFreeze({
    currency: pricing.currency,
    inputUsdMicrosPerMillionTokens,
    outputUsdMicrosPerMillionTokens,
  });
}
