import type { AgentManifestV1 } from "@osva-ai/contracts";
import { validateAgentManifest } from "@osva-ai/contracts";

import { InvalidAgentManifestError } from "./errors.js";

/**
 * Canonical Agent Manifest validation at the domain application boundary.
 * Does not mutate {@link manifest}; persistence uses the caller-supplied object.
 */
export function assertValidAgentManifest(manifest: AgentManifestV1): void {
  const result = validateAgentManifest(manifest);
  if (result.ok) {
    return;
  }

  throw new InvalidAgentManifestError(result.messages.join(" "));
}
