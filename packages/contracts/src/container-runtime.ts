export const OCI_SHA256_DIGEST_PREFIX = "sha256:" as const;

const OCI_SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * OSVA canonical digest-pinned OCI image reference for CONTAINER AgentVersions.
 *
 * Accepted form: `repository@sha256:<64-hex>`, for example
 * `registry.example.com/agent@sha256:<digest>`.
 *
 * Rejected forms include:
 * - mutable tag-only references such as `agent:latest` or `agent:v1`;
 * - canonical repository names containing `:tag`, even when followed by
 *   `@sha256:<digest>` (for example `agent:tag@sha256:<digest>`).
 *
 * Registry ports before the first `/` remain valid, for example
 * `localhost:5000/agent@sha256:<digest>`.
 */
export function isDigestPinnedOciImageReference(image: string): boolean {
  if (typeof image !== "string" || image.length === 0) {
    return false;
  }

  const atIndex = image.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === image.length - 1) {
    return false;
  }

  const digest = image.slice(atIndex + 1);
  if (
    !digest.startsWith(OCI_SHA256_DIGEST_PREFIX) ||
    !OCI_SHA256_HEX_PATTERN.test(digest.slice(OCI_SHA256_DIGEST_PREFIX.length))
  ) {
    return false;
  }

  const name = image.slice(0, atIndex);
  if (name.length === 0) {
    return false;
  }

  const slashIndex = name.indexOf("/");
  const pathPart = slashIndex >= 0 ? name.slice(slashIndex + 1) : name;

  // Reject repository:tag names even when a digest suffix is present.
  if (pathPart.includes(":")) {
    return false;
  }

  return true;
}
