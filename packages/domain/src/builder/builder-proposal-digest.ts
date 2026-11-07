import type { JsonValue } from "@osva-ai/contracts";

import { digestCanonicalJsonValue } from "../json-equality.js";

import type { BuilderProposalV1 } from "./builder-proposal.js";

/** Canonical sha256 digest of a validated {@link BuilderProposalV1} (property order independent). */
export function computeBuilderProposalDigest(
  proposal: BuilderProposalV1,
): string {
  return digestCanonicalJsonValue(proposal as unknown as JsonValue);
}
