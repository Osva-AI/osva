import { createHash } from "node:crypto";

import {
  INFERENCE_BUDGET_RESERVATION_KEY_PREFIX,
  INFERENCE_BUDGET_RESERVATION_KEY_VERSION,
  type InferenceBudgetReservationKeyV1,
  type InferenceInvocationId,
  type ModelProfileVersionId,
} from "@osva-ai/contracts";

import { canonicalJsonStringify } from "../json-equality.js";

const DOMAIN_SEPARATOR = "osva:inference-budget-reservation-key" as const;

export interface InferenceBudgetReservationKeyMaterialV1 {
  readonly version: typeof INFERENCE_BUDGET_RESERVATION_KEY_VERSION;
  readonly inferenceInvocationId: InferenceInvocationId;
  readonly providerAttemptIndex: number;
  readonly selectedModelProfileVersionId: ModelProfileVersionId;
}

export function deriveInferenceBudgetReservationKey(
  material: InferenceBudgetReservationKeyMaterialV1,
): InferenceBudgetReservationKeyV1 {
  if (
    !Number.isInteger(material.providerAttemptIndex) ||
    material.providerAttemptIndex < 0
  ) {
    throw new Error("providerAttemptIndex must be a non-negative integer");
  }

  const canonical = canonicalJsonStringify({
    version: material.version,
    inferenceInvocationId: material.inferenceInvocationId,
    providerAttemptIndex: material.providerAttemptIndex,
    selectedModelProfileVersionId: material.selectedModelProfileVersionId,
  });

  const hex = createHash("sha256")
    .update(DOMAIN_SEPARATOR, "utf8")
    .update("\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex")
    .toLowerCase();

  return `${INFERENCE_BUDGET_RESERVATION_KEY_PREFIX}${hex}` as InferenceBudgetReservationKeyV1;
}
