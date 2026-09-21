import type { Sql } from "postgres";

/** Deterministic PostgreSQL advisory-lock identity for OSVA schema migrations. */
export const OSVA_MIGRATION_ADVISORY_LOCK = {
  classId: 0x4f535641,
  objectId: 0x44424d47,
} as const;

export async function acquireMigrationAdvisoryLock(sql: Sql): Promise<void> {
  await sql`
    SELECT pg_advisory_lock(
      ${OSVA_MIGRATION_ADVISORY_LOCK.classId},
      ${OSVA_MIGRATION_ADVISORY_LOCK.objectId}
    )
  `;
}

export async function releaseMigrationAdvisoryLock(sql: Sql): Promise<void> {
  await sql`
    SELECT pg_advisory_unlock(
      ${OSVA_MIGRATION_ADVISORY_LOCK.classId},
      ${OSVA_MIGRATION_ADVISORY_LOCK.objectId}
    )
  `;
}

export async function tryAcquireMigrationAdvisoryLock(
  sql: Sql,
): Promise<boolean> {
  const rows = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(
      ${OSVA_MIGRATION_ADVISORY_LOCK.classId},
      ${OSVA_MIGRATION_ADVISORY_LOCK.objectId}
    ) AS locked
  `;
  return rows[0]?.locked === true;
}
