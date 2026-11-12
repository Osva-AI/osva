/** Stable per-submit idempotency key for message POST retries. */
export function createMessageIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}
