export function validateHelloOutput(
  output: unknown,
  message: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (typeof output !== "object" || output === null) {
    return { ok: false, message: "RunAttempt output is not an object." };
  }
  const echoed = (output as { echoed?: unknown }).echoed;
  if (typeof echoed !== "string") {
    return {
      ok: false,
      message: "RunAttempt output.echoed is not a string.",
    };
  }
  if (echoed !== message) {
    return {
      ok: false,
      message: `RunAttempt output.echoed '${echoed}' does not match input message '${message}'.`,
    };
  }
  return { ok: true };
}
