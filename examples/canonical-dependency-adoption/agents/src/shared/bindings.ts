export const MODEL_BINDING_PRIMARY = "primary" as const;

export const KNOWLEDGE_BINDING_POLICY_DOCS = "policy_docs" as const;

export const TOOL_BINDING_NPM_PACKAGE_METADATA =
  "npm_package_metadata" as const;
export const TOOL_BINDING_NPM_DOWNLOADS = "npm_downloads" as const;

export function researchToolIdempotencyKey(
  requestId: string,
  tool: "npm_package_metadata" | "npm_downloads",
): string {
  return `canonical:${requestId}:research:${tool}`;
}

export function reportArtifactIdempotencyKey(requestId: string): string {
  return `canonical-demo:report:${requestId}`;
}
