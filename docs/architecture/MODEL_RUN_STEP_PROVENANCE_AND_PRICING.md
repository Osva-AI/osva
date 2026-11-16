# MODEL RunStep provenance and cache-aware pricing

## Configured vs provider-reported identity

- **Configured** provider model identity is defined by the immutable `ModelProfileVersion` referenced from `RunStep.modelProfileVersionId`.
- **Provider-reported** identity is optional metadata from the adapter outcome (`providerReportedModelId`), persisted when sanitized.
- OSVA never substitutes requested/configured identity when the provider omits or withholds reported identity.

## Token semantics

- `inputTokens` is the adapter-normalized total input count.
- `cachedInputTokens` and `cacheWriteInputTokens` are **subsets** of input, not additive.
- `usageIncomplete` distinguishes partial provider accounting from complete zero-valued usage.
- Absent usage fields mean **unknown**, not zero.

## Pricing

`ModelProfileVersion.pricing` remains immutable. Optional fields:

- `cachedReadInputUsdMicrosPerMillionTokens`
- `cachedWriteInputUsdMicrosPerMillionTokens`

Cost formula (complete usage, all required rates present):

```text
uncachedInput = inputTokens - cachedInputTokens - cacheWriteInputTokens
cost = round(uncached × inputRate)
     + round(cachedInput × cachedReadRate)
     + round(cacheWrite × cachedWriteRate)
     + round(outputTokens × outputRate)
```

Each `round` is half-up to micro-USD per million tokens (see `estimateModelCostUsdMicros`).

### Missing rates

- Legacy profiles (input/output only) behave as before when **no** cache breakdown is reported.
- Positive `cachedInputTokens` without a cached-read rate → **unknown cost** (`null`).
- Positive `cacheWriteInputTokens` without a cached-write rate → **unknown cost** (`null`).
- Incomplete usage → **unknown cost** (`null`).
- Unknown cost must not be displayed or aggregated as zero.

### Provider-reported model eligibility

Configured `ModelProfileVersion` pricing applies only when provider-reported model is absent, exact match, or a documented version-suffix alias of the configured id (`isModelPricingEligible`). Otherwise cost is **unknown**.

## Persistence

MODEL `RunStep` rows store provenance and cache-write fields added in migration `0035_model_run_step_provenance`. Legacy rows remain valid with null/absent provenance columns.

## Related

- [Model call flow](./flows/model-call.md)
- [Provider capability matrix](./MODEL_PROVIDER_CAPABILITY_MATRIX.md)