export interface ResponseSecurityOptions {
  /** Operator/config literals that must never appear in serialized responses. */
  readonly forbiddenLiteralSubstrings?: readonly string[];
}

const MIN_FORBIDDEN_LITERAL_LENGTH = 8;

/** JSON object keys that must never appear on demo HTTP responses. */
const FORBIDDEN_JSON_KEY_PATTERN =
  /"(?:OSVA_API_KEY|apiKey|api_key|x-api-key|password|secret(?:Key|Ref)?|authorization)"\s*:/i;

/** Value-shaped patterns for connection strings and credential material. */
const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /\bOSVA_API_KEY\s*=/i,
  /postgres(?:ql)?:\/\/[^\s"\\]+/i,
  /valkey:\/\/[^\s"\\]+/i,
  /\brediss?:\/\/[^\s"\\@]*:[^\s"\\]+@[^\s"\\]+/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
];

function collectForbiddenLiterals(
  options: ResponseSecurityOptions,
): readonly string[] {
  const literals: string[] = [];
  for (const value of options.forbiddenLiteralSubstrings ?? []) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      literals.push(trimmed);
    }
  }
  return literals;
}

export function serializedResponseContainsSecretMaterial(
  serialized: string,
  options: ResponseSecurityOptions = {},
): boolean {
  if (serialized.includes("OSVA_API_KEY")) {
    return true;
  }

  for (const literal of collectForbiddenLiterals(options)) {
    if (literal.length >= MIN_FORBIDDEN_LITERAL_LENGTH) {
      if (serialized.includes(literal)) {
        return true;
      }
      continue;
    }
    if (serialized.includes(literal)) {
      return true;
    }
  }

  if (FORBIDDEN_JSON_KEY_PATTERN.test(serialized)) {
    return true;
  }

  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialized)) {
      return true;
    }
  }

  return false;
}

export function safeDemoErrorMessage(
  message: string,
  options: ResponseSecurityOptions = {},
): string {
  if (serializedResponseContainsSecretMaterial(message, options)) {
    return "Demo server error.";
  }
  return message;
}
