import type { AgentManifestV1 } from "./agent-manifest.js";
import { agentManifestSchema } from "./schemas/agent-manifest.js";

export type AgentManifestValidationResult =
  | { readonly ok: true; readonly manifest: AgentManifestV1 }
  | { readonly ok: false; readonly messages: readonly string[] };

/**
 * Canonical Agent Manifest parse/validation (Zod + declarative cross-field rules).
 * Does not mutate the input value.
 */
export function validateAgentManifest(
  manifest: unknown,
): AgentManifestValidationResult {
  const result = agentManifestSchema.safeParse(manifest);
  if (result.success) {
    return { ok: true, manifest: result.data };
  }

  const messages = result.error.issues
    .map((issue) => issue.message)
    .filter((message) => message.length > 0);

  return {
    ok: false,
    messages:
      messages.length > 0
        ? messages
        : (["Agent manifest is invalid."] as const),
  };
}
