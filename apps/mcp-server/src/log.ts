export function logEvent(
  event: string,
  fields?: Record<string, string | number | boolean | undefined>,
): void {
  const payload = {
    event,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
