import {
  readAnthropicSdkProviderErrorType,
  readAnthropicSdkProviderMessage,
} from "./anthropic-sdk-error-body.js";

export const ANTHROPIC_PROVIDER_ERROR_TEXT_DISPLAY_ENV =
  "OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT" as const;

const MAX_SAFE_MESSAGE_CHARS = 2048;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;
const CREDENTIAL_LIKE = [
  /sk-ant-[A-Za-z0-9_-]+/i,
  /\bsk-[A-Za-z0-9]{10,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /x-api-key\s*[:=]/i,
  /api[_-]?key\s*[:=]/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /anthropic-api-key/i,
];

export function isAnthropicProviderErrorTextDisplayEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[ANTHROPIC_PROVIDER_ERROR_TEXT_DISPLAY_ENV]?.trim();
  return value === "1" || value === "true";
}

export type AnthropicProviderErrorLocalDisplay =
  | {
      readonly ok: true;
      readonly errorType: string;
      readonly errorMessage: string;
      readonly requestId?: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

/**
 * Fail-closed gate for operator-local display of Anthropic error.message.
 * Never used for Console, BFF, artifacts, or test snapshots of live responses.
 */
export function assessAnthropicProviderErrorMessageForLocalDisplay(input: {
  readonly errorType?: string;
  readonly errorMessage?: string;
  readonly requestId?: string;
}): AnthropicProviderErrorLocalDisplay {
  const errorType = input.errorType?.trim();
  if (errorType === undefined || errorType.length === 0) {
    return {
      ok: false,
      reason: "provider error.type missing; local display refused",
    };
  }
  if (!SAFE_TOKEN.test(errorType)) {
    return {
      ok: false,
      reason: "provider error.type failed token safety; local display refused",
    };
  }

  const requestId = input.requestId?.trim();
  if (
    requestId !== undefined &&
    requestId.length > 0 &&
    !SAFE_TOKEN.test(requestId)
  ) {
    return {
      ok: false,
      reason: "provider request_id failed token safety; local display refused",
    };
  }

  const errorMessage = input.errorMessage?.trim();
  if (errorMessage === undefined || errorMessage.length === 0) {
    return {
      ok: false,
      reason: "provider error.message missing; local display refused",
    };
  }
  if (errorMessage.length > MAX_SAFE_MESSAGE_CHARS) {
    return {
      ok: false,
      reason: "provider error.message exceeds local display length; refused",
    };
  }
  if (hasUnsafeControlCharacters(errorMessage)) {
    return {
      ok: false,
      reason: "provider error.message contains control characters; refused",
    };
  }
  for (const pattern of CREDENTIAL_LIKE) {
    if (pattern.test(errorMessage)) {
      return {
        ok: false,
        reason:
          "provider error.message contains credential-like material; local display refused",
      };
    }
  }

  return {
    ok: true,
    errorType,
    errorMessage,
    ...(requestId !== undefined && requestId.length > 0 ? { requestId } : {}),
  };
}

export function assessAnthropicParsedErrorForLocalDisplay(input: {
  readonly parsed: unknown;
  readonly requestId?: string;
}): AnthropicProviderErrorLocalDisplay {
  return assessAnthropicProviderErrorMessageForLocalDisplay({
    errorType: readAnthropicSdkProviderErrorType(input.parsed),
    errorMessage: readAnthropicSdkProviderMessage(input.parsed),
    requestId: input.requestId,
  });
}

function hasUnsafeControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return true;
    }
  }
  return false;
}

export function formatAnthropicProviderErrorLocalInspection(input: {
  readonly httpStatus: number;
  readonly display: Extract<AnthropicProviderErrorLocalDisplay, { ok: true }>;
}): string {
  const requestId = input.display.requestId ?? "(absent)";
  return [
    "ANTHROPIC_LOCAL_ERROR_INSPECTION",
    `httpStatus: ${String(input.httpStatus)}`,
    `error.type: ${input.display.errorType}`,
    `request_id: ${requestId}`,
    "error.message:",
    input.display.errorMessage,
    "",
  ].join("\n");
}
