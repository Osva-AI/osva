import { redactSecrets } from "../doctor/redact.js";

const WORKSPACE_ID_PATTERN =
  /Workspace ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const BOOTSTRAP_API_KEY_PATTERN = /(osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+)/;

const SETUP_TOKEN_MARKER =
  "One-time password setup token (single use; do not log or share):";

export function parseBootstrapApiKey(stdout: string): string | undefined {
  const match = stdout.match(BOOTSTRAP_API_KEY_PATTERN);
  return match?.[1];
}

export function parseWorkspaceBootstrapOutput(stdout: string): {
  readonly workspaceId?: string;
  readonly alreadyCompleted: boolean;
  readonly apiKey?: string;
} {
  const alreadyCompleted = stdout.includes(
    "Installation bootstrap has already completed",
  );
  const match = stdout.match(WORKSPACE_ID_PATTERN);
  const apiKey = parseBootstrapApiKey(stdout);
  return {
    ...(match?.[1] === undefined ? {} : { workspaceId: match[1] }),
    ...(apiKey === undefined ? {} : { apiKey }),
    alreadyCompleted,
  };
}

export function parseIdentityBootstrapSetupToken(
  stdout: string,
): string | undefined {
  const lines = stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== SETUP_TOKEN_MARKER) {
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next]?.trim() ?? "";
      if (candidate.length === 0) {
        continue;
      }
      if (candidate.startsWith("Complete setup:")) {
        return undefined;
      }
      return candidate;
    }
  }
  return undefined;
}

export function redactBootstrapSubprocessOutput(text: string): string {
  let redacted = redactSecrets(text);
  redacted = redactLineAfterMarker(
    redacted,
    SETUP_TOKEN_MARKER,
    "[setup-token-redacted]",
  );
  redacted = redactLineAfterMarker(
    redacted,
    "Copy the API key below now. It cannot be retrieved again:",
    "osva_ak_***",
  );
  return redacted;
}

function redactLineAfterMarker(
  text: string,
  marker: string,
  replacement: string,
): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    output.push(lines[index] ?? "");
    if (lines[index]?.trim() === marker) {
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next]?.trim() ?? "";
        if (candidate.length === 0) {
          output.push(lines[next] ?? "");
          continue;
        }
        output.push(replacement);
        index = next;
        break;
      }
    }
  }
  return output.join("\n");
}
