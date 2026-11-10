import { createHash } from "node:crypto";

const SAFE_REASON_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Opt-in operator diagnostics for Anthropic HTTP 4xx bodies.
 * Never persisted when {@link isAnthropicProviderErrorDiagnosticsEnabled} is false.
 */
export function isAnthropicProviderErrorDiagnosticsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS?.trim();
  return value === "1" || value === "true";
}

export function fingerprintAnthropicProviderErrorMessage(
  message: string | undefined,
): string | undefined {
  if (message === undefined || message.trim().length === 0) {
    return undefined;
  }

  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Allowlisted substrings extracted from provider messages (no full message). */
export function extractAnthropicProviderErrorReasonTokens(
  message: string | undefined,
): readonly string[] {
  if (message === undefined) {
    return [];
  }

  const tokens = new Set<string>();

  const paramMatch = message.match(
    /^([A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)+)\s*:/,
  );
  if (paramMatch?.[1] !== undefined && SAFE_REASON_TOKEN.test(paramMatch[1])) {
    tokens.add(paramMatch[1]);
  }

  const propertyMatches = message.matchAll(/property '([A-Za-z0-9_]+)'/gi);
  for (const match of propertyMatches) {
    const token = match[1];
    if (token !== undefined && SAFE_REASON_TOKEN.test(token)) {
      tokens.add(token);
    }
  }

  const lower = message.toLowerCase();
  if (lower.includes("anthropic-workspace-id")) {
    tokens.add("anthropic-workspace-id");
  }
  if (lower.includes("output_format")) {
    tokens.add("output_format");
  }
  if (lower.includes("output_config")) {
    tokens.add("output_config");
  }
  if (
    lower.includes("compiled grammar") ||
    lower.includes("grammar is too large")
  ) {
    tokens.add("compiled_grammar");
  }

  return [...tokens].slice(0, 8);
}
