import type { AgentManifestV1 } from "@osva-ai/contracts";

import { canonicalJson } from "../validate/canonical-json.js";

export function manifestFingerprint(manifest: AgentManifestV1): string {
  const runtime = manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    throw new Error("Agent manifest must use TRUSTED_TYPESCRIPT.");
  }
  return canonicalJson(manifest);
}

export function manifestsMatch(
  left: AgentManifestV1,
  right: AgentManifestV1,
): boolean {
  return manifestFingerprint(left) === manifestFingerprint(right);
}
