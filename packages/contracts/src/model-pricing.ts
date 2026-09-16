export const MODEL_PRICING_CURRENCIES = ["USD"] as const;

export type ModelPricingCurrency = (typeof MODEL_PRICING_CURRENCIES)[number];

/** Maximum micro-USD per million tokens (100 USD/M). */
export const MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS = 100_000_000;

export interface ModelProfileVersionPricing {
  readonly currency: ModelPricingCurrency;
  readonly inputUsdMicrosPerMillionTokens: number;
  readonly outputUsdMicrosPerMillionTokens: number;
}

export function isModelPricingCurrency(
  value: string,
): value is ModelPricingCurrency {
  return (MODEL_PRICING_CURRENCIES as readonly string[]).includes(value);
}
