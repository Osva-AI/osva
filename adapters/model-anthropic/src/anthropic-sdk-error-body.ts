/** Parsed Anthropic API error JSON body attached to SDK BadRequestError.error. */
export interface AnthropicSdkErrorBody {
  readonly type?: string;
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
  };
}

/**
 * Reads provider validation text from the SDK error attachment.
 * Ignores APIError.message (status-prefixed SDK summary).
 */
export function readAnthropicSdkProviderMessage(
  sdkErrorAttachment: unknown,
): string | undefined {
  if (sdkErrorAttachment === null || typeof sdkErrorAttachment !== "object") {
    return undefined;
  }

  const record = sdkErrorAttachment as Record<string, unknown>;
  const nested =
    record.error !== null && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;

  const nestedMessage = nested.message;
  if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
    return nestedMessage;
  }

  const topLevelMessage = record.message;
  if (
    typeof topLevelMessage === "string" &&
    topLevelMessage.trim().length > 0
  ) {
    return topLevelMessage;
  }

  return undefined;
}

export function readAnthropicSdkProviderErrorType(
  sdkErrorAttachment: unknown,
): string | undefined {
  if (sdkErrorAttachment === null || typeof sdkErrorAttachment !== "object") {
    return undefined;
  }

  const record = sdkErrorAttachment as Record<string, unknown>;
  const nested =
    record.error !== null && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;

  const type = nested.type;
  return typeof type === "string" ? type : undefined;
}
