export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({ event, ...fields, ts: new Date().toISOString() })}\n`,
  );
}

export function logError(event: string, error: unknown): void {
  process.stderr.write(
    `${JSON.stringify({
      event,
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    })}\n`,
  );
}
