export function sanitizeReturnPath(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return undefined;
  }
  if (trimmed.includes("\\") || trimmed.includes("\0")) {
    return undefined;
  }
  return trimmed;
}
