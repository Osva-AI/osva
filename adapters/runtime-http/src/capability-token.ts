import { createHmac, timingSafeEqual } from "node:crypto";

export const RUNTIME_BOOTSTRAP_TOKEN_AUD = "bootstrap" as const;

export interface CapabilityTokenClaims {
  readonly v: 1;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly exp: number;
}

export interface BootstrapTokenClaims {
  readonly v: 1;
  readonly aud: typeof RUNTIME_BOOTSTRAP_TOKEN_AUD;
  readonly executionId: string;
  readonly exp: number;
}

export const CAPABILITY_TOKEN_SKEW_MS = 5_000;

export function issueCapabilityToken(
  secret: string,
  claims: Omit<CapabilityTokenClaims, "v">,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      executionId: claims.executionId,
      workspaceId: claims.workspaceId,
      runId: claims.runId,
      exp: claims.exp,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyCapabilityToken(
  secret: string,
  token: string,
  now: Date,
): CapabilityTokenClaims | undefined {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return undefined;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(secret, payload);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("v" in parsed) ||
    parsed.v !== 1 ||
    ("aud" in parsed &&
      (parsed as { aud?: unknown }).aud === RUNTIME_BOOTSTRAP_TOKEN_AUD)
  ) {
    return undefined;
  }

  if (
    !isNonEmptyString(parsed, "executionId") ||
    !isNonEmptyString(parsed, "workspaceId") ||
    !isNonEmptyString(parsed, "runId") ||
    !("exp" in parsed) ||
    typeof parsed.exp !== "number" ||
    !Number.isFinite(parsed.exp)
  ) {
    return undefined;
  }

  if (now.getTime() >= parsed.exp) {
    return undefined;
  }

  return {
    v: 1,
    executionId: parsed.executionId,
    workspaceId: parsed.workspaceId,
    runId: parsed.runId,
    exp: parsed.exp,
  };
}

export function issueBootstrapToken(
  secret: string,
  claims: Omit<BootstrapTokenClaims, "v" | "aud">,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      aud: RUNTIME_BOOTSTRAP_TOKEN_AUD,
      executionId: claims.executionId,
      exp: claims.exp,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyBootstrapToken(
  secret: string,
  token: string,
  now: Date,
): BootstrapTokenClaims | undefined {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return undefined;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(secret, payload);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("v" in parsed) ||
    parsed.v !== 1 ||
    !("aud" in parsed) ||
    (parsed as { aud?: unknown }).aud !== RUNTIME_BOOTSTRAP_TOKEN_AUD ||
    !("executionId" in parsed) ||
    typeof (parsed as { executionId?: unknown }).executionId !== "string" ||
    ((parsed as { executionId: string }).executionId?.length ?? 0) === 0 ||
    !("exp" in parsed) ||
    typeof (parsed as { exp?: unknown }).exp !== "number" ||
    !Number.isFinite((parsed as { exp: number }).exp)
  ) {
    return undefined;
  }

  const exp = (parsed as { exp: number }).exp;
  if (now.getTime() >= exp) {
    return undefined;
  }

  return {
    v: 1,
    aud: RUNTIME_BOOTSTRAP_TOKEN_AUD,
    executionId: (parsed as { executionId: string }).executionId,
    exp,
  };
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
}

function isNonEmptyString(
  value: object,
  key: "executionId" | "workspaceId" | "runId",
): value is Record<typeof key, string> {
  return (
    key in value &&
    typeof (value as Record<string, unknown>)[key] === "string" &&
    ((value as Record<string, string>)[key]?.length ?? 0) > 0
  );
}
