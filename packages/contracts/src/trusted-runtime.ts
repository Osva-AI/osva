export const SHA256_INTEGRITY_PREFIX = "sha256:" as const;

const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;

/**
 * Relative POSIX path to a trusted TypeScript entrypoint beneath the operator
 * runtime root. Absolute paths, Windows prefixes, NUL bytes, backslashes, empty
 * segments, and `..` traversal are rejected at the contract boundary.
 */
export function isRelativeTrustedEntrypoint(entrypoint: string): boolean {
  if (typeof entrypoint !== "string" || entrypoint.length === 0) {
    return false;
  }

  if (
    entrypoint.includes("\0") ||
    entrypoint.includes("\\") ||
    entrypoint.startsWith("/") ||
    entrypoint.startsWith("//") ||
    WINDOWS_DRIVE_PATTERN.test(entrypoint)
  ) {
    return false;
  }

  const segments = entrypoint.split("/");
  if (segments.length === 0) {
    return false;
  }

  let hasFileSegment = false;
  for (const segment of segments) {
    if (segment.length === 0 || segment === "..") {
      return false;
    }

    if (segment !== ".") {
      hasFileSegment = true;
    }
  }

  return hasFileSegment;
}

export function isSha256IntegrityDigest(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith(SHA256_INTEGRITY_PREFIX)) {
    return false;
  }

  return SHA256_HEX_PATTERN.test(value.slice(SHA256_INTEGRITY_PREFIX.length));
}

export function sha256IntegrityHex(value: string): string | undefined {
  if (!isSha256IntegrityDigest(value)) {
    return undefined;
  }

  return value.slice(SHA256_INTEGRITY_PREFIX.length).toLowerCase();
}
