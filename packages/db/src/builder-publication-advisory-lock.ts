import { sql } from "drizzle-orm";

/** Serializes concurrent publication attempts for the same workspace idempotency key. */
export function builderPublicationAdvisoryXactLock(
  workspaceId: string,
  idempotencyKey: string,
) {
  return sql`SELECT pg_advisory_xact_lock(
    hashtext(${workspaceId}),
    hashtext(${idempotencyKey})
  )`;
}
