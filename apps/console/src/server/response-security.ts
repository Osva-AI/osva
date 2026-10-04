export interface ResponseSecurityOptions {
  readonly forbiddenLiteralSubstrings?: readonly string[];
}

export function serializedResponseContainsSecretMaterial(
  serialized: string,
  options: ResponseSecurityOptions = {},
): boolean {
  for (const forbidden of options.forbiddenLiteralSubstrings ?? []) {
    if (forbidden.length > 0 && serialized.includes(forbidden)) {
      return true;
    }
  }
  return false;
}

export function assertSafeSerializedResponse(
  serialized: string,
  options: ResponseSecurityOptions = {},
): void {
  if (serializedResponseContainsSecretMaterial(serialized, options)) {
    throw new Error("Console response would expose forbidden secret material.");
  }
}
