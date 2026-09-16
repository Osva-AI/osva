import { z } from "zod";

import {
  MODEL_PRICING_CURRENCIES,
  MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS,
} from "../model-pricing.js";

export const modelPricingCurrencySchema = z.enum(MODEL_PRICING_CURRENCIES);

export const modelProfileVersionPricingSchema = z.strictObject({
  currency: modelPricingCurrencySchema,
  inputUsdMicrosPerMillionTokens: z
    .int()
    .nonnegative()
    .max(MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS),
  outputUsdMicrosPerMillionTokens: z
    .int()
    .nonnegative()
    .max(MODEL_PRICING_MAX_USD_MICROS_PER_MILLION_TOKENS),
});
