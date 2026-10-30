export const BACKUP_ATTESTATION_FLAG = "backup-confirmed";

export function backupRequirementsText(): string {
  return [
    "Before upgrading OSVA you must back up durable state manually:",
    "",
    "1. PostgreSQL — logical dump (pg_dump) or your managed snapshot process.",
    "   OSVA stores Runs, workflows, agents, API keys, and migration history in PostgreSQL.",
    "2. Artifact storage — back up the Compose artifact volume (filesystem mode) or your S3 bucket.",
    "3. Document secrets separately — OSVA does not back up OSVA_AUTH_SECRET or provider keys.",
    "",
    "OSVA migrations are forward-only. A backup confirmation flag is operator attestation only;",
    "it does not prove a backup exists or that restore was tested.",
    "",
    "See docs/operations/BACKUP_AND_RECOVERY.md and docs/operations/UPGRADE.md.",
  ].join("\n");
}

export function requiresBackupAttestation(migrationRequired: boolean): boolean {
  return migrationRequired;
}
