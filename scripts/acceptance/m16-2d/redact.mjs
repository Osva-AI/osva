const API_KEY_PATTERN = /osva_ak_[A-Za-z0-9._-]+/g;
const SECRET_ASSIGNMENT =
  /(POSTGRES_PASSWORD|OSVA_AUTH_SECRET|VALKEY_PASSWORD)=(\S+)/g;
const RECOVERY_TOKEN_MARKER =
  "One-time recovery token (single use; do not log or share):";

export function redactSecrets(text) {
  return String(text)
    .replace(API_KEY_PATTERN, "osva_ak_***")
    .replace(SECRET_ASSIGNMENT, "$1=***");
}

export function assertRedacted(text) {
  if (/osva_ak_[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/.test(text)) {
    throw new Error("Expected redacted output still contains an API key.");
  }
}

export function parseRecoveryToken(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== RECOVERY_TOKEN_MARKER) {
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next]?.trim() ?? "";
      if (candidate.length === 0) {
        continue;
      }
      if (candidate.startsWith("Complete recovery:")) {
        return undefined;
      }
      return candidate;
    }
  }
  return undefined;
}

export function redactRecoveryCliOutput(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    output.push(lines[index] ?? "");
    if (lines[index]?.trim() === RECOVERY_TOKEN_MARKER) {
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next]?.trim() ?? "";
        if (candidate.length === 0) {
          output.push(lines[next] ?? "");
          continue;
        }
        output.push("[recovery-token-redacted]");
        index = next;
        break;
      }
    }
  }
  return redactSecrets(output.join("\n"));
}
