export function logEvent(
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export function logError(event: string, error: unknown): void {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "An unexpected error occurred.";

  console.error(JSON.stringify({ event, message }));
}
