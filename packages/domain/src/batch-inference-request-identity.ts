import { createHash } from "node:crypto";

import type {
  BatchInferenceItemRequest,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
} from "@osva-ai/contracts";

import { canonicalJsonStringify } from "./json-equality.js";

export interface BatchInferenceRequestMaterialIdentity {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly providerConnectionVersionId: ModelProviderConnectionVersionId;
  readonly items: readonly Pick<
    BatchInferenceItemRequest,
    "providerCorrelationId" | "input"
  >[];
}

export function computeBatchInferenceRequestMaterialHash(
  identity: BatchInferenceRequestMaterialIdentity,
): string {
  const normalized = {
    modelProfileVersionId: identity.modelProfileVersionId,
    providerConnectionVersionId: identity.providerConnectionVersionId,
    items: [...identity.items]
      .map((item) => ({
        providerCorrelationId: item.providerCorrelationId,
        input: item.input,
      }))
      .sort((a, b) =>
        a.providerCorrelationId.localeCompare(b.providerCorrelationId),
      ),
  };
  const canonical = canonicalJsonStringify(
    JSON.parse(JSON.stringify(normalized)),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
