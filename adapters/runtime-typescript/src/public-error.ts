const WINDOWS_ABSOLUTE = /[A-Za-z]:\\[^\s'"]+/g;
const POSIX_ABSOLUTE = /(?:^|\s)(\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)/g;

export function sanitizePublicErrorMessage(
  message: string,
  fallback: string,
): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return fallback;
  }

  const redacted = firstLine
    .replace(WINDOWS_ABSOLUTE, "[path]")
    .replace(POSIX_ABSOLUTE, " [path]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/OPENAI_API_KEY[=:]\s*\S+/gi, "OPENAI_API_KEY=[redacted]")
    .trim();

  return redacted.length === 0 ? fallback : redacted.slice(0, 500);
}

export function executionFailure(
  code: string,
  message: string,
): {
  readonly status: "failed";
  readonly error: { readonly code: string; readonly message: string };
} {
  return {
    status: "failed",
    error: {
      code,
      message: sanitizePublicErrorMessage(
        message,
        "Trusted runtime execution failed.",
      ),
    },
  };
}
