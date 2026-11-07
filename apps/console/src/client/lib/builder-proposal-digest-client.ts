import { APPROVAL_OPERATION_DIGEST_PREFIX } from "@osva-ai/contracts";
import type { JsonValue } from "@osva-ai/contracts";

import { parseBuilderProposalV1 } from "@osva/domain/builder/parse";

function sortKeys(value: JsonValue): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  const objectValue = value as Record<string, JsonValue>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(objectValue).sort()) {
    sorted[key] = sortKeys(objectValue[key] as JsonValue);
  }
  return sorted;
}

function canonicalJsonStringify(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}

/** Browser-isomorphic digest matching server `computeBuilderProposalDigest`. */
export async function digestBuilderDraftProposal(
  proposal: unknown,
): Promise<string | undefined> {
  const parsed = parseBuilderProposalV1(proposal);
  if (!parsed.ok) {
    return undefined;
  }
  const text = canonicalJsonStringify(parsed.proposal as unknown as JsonValue);
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${APPROVAL_OPERATION_DIGEST_PREFIX}${hex}`;
}
