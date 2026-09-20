export function logEvent(
  event: string,
  fields?: Readonly<Record<string, unknown>>,
): void {
  const payload = fields === undefined ? { event } : { event, ...fields };
  console.log(JSON.stringify(payload));
}
