import type { Sql } from "postgres";

import {
  readMigrationStatus,
  type MigrationRepositoryStatus,
  type MigrationStatusSnapshot,
} from "./migration-status.js";
import { readDrizzleJournal } from "./migration-history.js";

export const LEASE_SLICE_MIGRATION_TAG = "0023_execution_lease_slice";

export type SchemaIntegrityOutcome =
  | "not_migrated"
  | "applied_and_matches"
  | "schema_mismatch"
  | "schema_ahead"
  | "database_inaccessible"
  | "unknown";

export type SchemaObjectKind = "column" | "index";

export interface SchemaObjectCheck {
  readonly id: string;
  readonly kind: SchemaObjectKind;
  readonly table: string;
  readonly name: string;
  readonly ok: boolean;
  readonly expected: string;
  readonly actual?: string;
}

export interface SchemaIntegrityJournal {
  readonly repositoryHead?: string;
  readonly databaseHead?: string;
  readonly appliedCount: number;
  readonly repositoryCount: number;
  readonly pendingMigrations: readonly string[];
  readonly journalStatus: MigrationRepositoryStatus | "inaccessible";
}

export interface SchemaIntegrityReport {
  readonly outcome: SchemaIntegrityOutcome;
  readonly journal: SchemaIntegrityJournal;
  readonly checks: readonly SchemaObjectCheck[];
  readonly diagnostics: readonly string[];
}

export interface ExpectedColumn {
  readonly table: string;
  readonly column: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly defaultIncludes?: string;
}

export interface ExpectedIndex {
  readonly table: string;
  readonly name: string;
  readonly definitionIncludes: readonly string[];
}

export const LEASE_SLICE_COLUMNS: readonly ExpectedColumn[] = [
  {
    table: "run_attempts",
    column: "execution_owner",
    dataType: "text",
    nullable: true,
  },
  {
    table: "run_attempts",
    column: "execution_generation",
    dataType: "integer",
    nullable: false,
    defaultIncludes: "0",
  },
  {
    table: "run_attempts",
    column: "lease_expires_at",
    dataType: "timestamp with time zone",
    nullable: true,
  },
];

export const LEASE_SLICE_INDEXES: readonly ExpectedIndex[] = [
  {
    table: "run_attempts",
    name: "run_attempts_expired_lease_idx",
    definitionIncludes: ["lease_expires_at", "RUNNING", "execution_owner"],
  },
];

interface CatalogColumn {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

interface CatalogIndex {
  readonly indexname: string;
  readonly indexdef: string;
}

export function journalClaimsMigration(
  repositoryTags: readonly string[],
  appliedCount: number,
  tag: string,
): boolean {
  const index = repositoryTags.indexOf(tag);
  return index >= 0 && appliedCount > index;
}

export function classifySchemaIntegrity(input: {
  readonly journalClaimsLeaseSlice: boolean;
  readonly checks: readonly SchemaObjectCheck[];
}): SchemaIntegrityOutcome {
  const present = input.checks.filter(
    (check) => check.actual !== undefined && check.actual !== "missing",
  );
  const allOk =
    input.checks.length > 0 && input.checks.every((check) => check.ok);

  if (input.journalClaimsLeaseSlice) {
    return allOk ? "applied_and_matches" : "schema_mismatch";
  }

  if (present.length === 0) {
    return "not_migrated";
  }

  return allOk ? "schema_ahead" : "schema_mismatch";
}

export function evaluateColumnCheck(
  expected: ExpectedColumn,
  actual: CatalogColumn | undefined,
): SchemaObjectCheck {
  const id = `column:${expected.table}.${expected.column}`;
  const expectedText = [
    expected.dataType,
    expected.nullable ? "nullable" : "not null",
    expected.defaultIncludes === undefined
      ? undefined
      : `default includes ${expected.defaultIncludes}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  if (actual === undefined) {
    return {
      id,
      kind: "column",
      table: expected.table,
      name: expected.column,
      ok: false,
      expected: expectedText,
      actual: "missing",
    };
  }

  const typeOk =
    normalizeType(actual.data_type) === normalizeType(expected.dataType);
  const nullableOk =
    (actual.is_nullable.toUpperCase() === "YES") === expected.nullable;
  const defaultOk =
    expected.defaultIncludes === undefined ||
    (actual.column_default ?? "").includes(expected.defaultIncludes);
  const ok = typeOk && nullableOk && defaultOk;
  const actualText = [
    actual.data_type,
    actual.is_nullable.toUpperCase() === "YES" ? "nullable" : "not null",
    actual.column_default === null
      ? "no default"
      : `default ${actual.column_default}`,
  ].join(", ");

  return {
    id,
    kind: "column",
    table: expected.table,
    name: expected.column,
    ok,
    expected: expectedText,
    actual: actualText,
  };
}

export function evaluateIndexCheck(
  expected: ExpectedIndex,
  actual: CatalogIndex | undefined,
): SchemaObjectCheck {
  const id = `index:${expected.name}`;
  const expectedText = `present on ${expected.table}; definition includes ${expected.definitionIncludes.join(", ")}`;

  if (actual === undefined) {
    return {
      id,
      kind: "index",
      table: expected.table,
      name: expected.name,
      ok: false,
      expected: expectedText,
      actual: "missing",
    };
  }

  const definition = actual.indexdef;
  const ok = expected.definitionIncludes.every((fragment) =>
    definition.includes(fragment),
  );

  return {
    id,
    kind: "index",
    table: expected.table,
    name: expected.name,
    ok,
    expected: expectedText,
    actual: definition,
  };
}

export async function verifySchemaIntegrity(
  sql: Sql,
): Promise<SchemaIntegrityReport> {
  let journalSnapshot: MigrationStatusSnapshot;
  try {
    journalSnapshot = await readJournalSnapshot(sql);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return inaccessibleReport();
    }
    return unknownReport("Could not read applied migration history.");
  }

  let checks: SchemaObjectCheck[];
  try {
    checks = await inspectLeaseSliceSchema(sql);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return inaccessibleReport(journalSnapshot);
    }
    return unknownReport(
      "Could not inspect the physical schema catalog.",
      journalSnapshot,
    );
  }

  const repositoryTags = readDrizzleJournal().entries.map((entry) => entry.tag);
  const journalClaimsLeaseSlice = journalClaimsMigration(
    repositoryTags,
    journalSnapshot.databaseAppliedCount,
    LEASE_SLICE_MIGRATION_TAG,
  );
  const outcome = classifySchemaIntegrity({
    journalClaimsLeaseSlice,
    checks,
  });

  return {
    outcome,
    journal: toIntegrityJournal(journalSnapshot),
    checks,
    diagnostics: formatDiagnostics(outcome, journalClaimsLeaseSlice, checks),
  };
}

export function formatSchemaIntegrity(report: SchemaIntegrityReport): string {
  const failed = report.checks.filter((check) => !check.ok);
  const lines = [
    `schema integrity: ${report.outcome}`,
    `journal status: ${report.journal.journalStatus}`,
    `repository head: ${report.journal.repositoryHead ?? "(none)"}`,
    `database head: ${report.journal.databaseHead ?? "(none)"}`,
    `database applied count: ${String(report.journal.appliedCount)}`,
    `pending migrations: ${
      report.journal.pendingMigrations.length === 0
        ? "(none)"
        : report.journal.pendingMigrations.join(", ")
    }`,
    `failed checks: ${
      failed.length === 0
        ? "(none)"
        : failed.map((check) => check.id).join(", ")
    }`,
    ...report.diagnostics.map((line) => `diagnostic: ${line}`),
  ];
  return lines.join("\n");
}

function toIntegrityJournal(
  snapshot: MigrationStatusSnapshot,
): SchemaIntegrityJournal {
  return {
    repositoryHead: snapshot.repositoryHead,
    databaseHead: snapshot.databaseHead,
    appliedCount: snapshot.databaseAppliedCount,
    repositoryCount: snapshot.repositoryAppliedCount,
    pendingMigrations: snapshot.pendingMigrations,
    journalStatus: snapshot.status,
  };
}

async function readJournalSnapshot(sql: Sql): Promise<MigrationStatusSnapshot> {
  return readMigrationStatus(sql);
}

async function inspectLeaseSliceSchema(sql: Sql): Promise<SchemaObjectCheck[]> {
  const columnRows = await sql<CatalogColumn[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'run_attempts'
      AND column_name IN (
        'execution_owner',
        'execution_generation',
        'lease_expires_at'
      )
  `;
  const columnsByName = new Map(
    columnRows.map((row) => [row.column_name, row] as const),
  );
  const indexRows = await sql<CatalogIndex[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'run_attempts'
      AND indexname = 'run_attempts_expired_lease_idx'
  `;
  const index = indexRows[0];

  return [
    ...LEASE_SLICE_COLUMNS.map((expected) =>
      evaluateColumnCheck(expected, columnsByName.get(expected.column)),
    ),
    ...LEASE_SLICE_INDEXES.map((expected) =>
      evaluateIndexCheck(expected, index),
    ),
  ];
}

function formatDiagnostics(
  outcome: SchemaIntegrityOutcome,
  journalClaimsLeaseSlice: boolean,
  checks: readonly SchemaObjectCheck[],
): readonly string[] {
  const failed = checks.filter((check) => !check.ok);
  switch (outcome) {
    case "applied_and_matches":
      return [
        "Applied migration history includes 0023_execution_lease_slice and the physical lease columns and recovery index match.",
      ];
    case "not_migrated":
      return [
        "Migration 0023_execution_lease_slice is not applied. Run the explicit migrate job after taking a backup.",
      ];
    case "schema_mismatch":
      return [
        journalClaimsLeaseSlice
          ? "The migration journal claims 0023_execution_lease_slice is applied, but the physical schema does not match. Do not rerun the migration file automatically."
          : "Lease-slice schema objects are incomplete or incorrectly defined.",
        "Verify a PostgreSQL backup, compare information_schema and pg_indexes to the expected 0023 objects, and apply an explicit reviewed repair.",
        ...failed.map(
          (check) =>
            `${check.id} expected ${check.expected}; observed ${check.actual ?? "missing"}.`,
        ),
      ];
    case "schema_ahead":
      return [
        "Physical 0023 lease-slice objects exist, but the migration journal does not claim 0023_execution_lease_slice.",
        "Do not delete or rewrite applied-history rows. Compare backups and journal state before any explicit repair.",
      ];
    case "database_inaccessible":
      return ["PostgreSQL is unreachable. Schema integrity was not evaluated."];
    case "unknown":
      return [
        "Migration or catalog state could not be classified. Inspect PostgreSQL connectivity and drizzle.__drizzle_migrations without exposing credentials.",
      ];
  }
}

function inaccessibleReport(
  journal?: MigrationStatusSnapshot,
): SchemaIntegrityReport {
  return {
    outcome: "database_inaccessible",
    journal: journal
      ? toIntegrityJournal(journal)
      : {
          appliedCount: 0,
          repositoryCount: readDrizzleJournal().entries.length,
          pendingMigrations: [],
          journalStatus: "inaccessible",
        },
    checks: [],
    diagnostics: formatDiagnostics("database_inaccessible", false, []),
  };
}

function unknownReport(
  message: string,
  journal?: MigrationStatusSnapshot,
): SchemaIntegrityReport {
  return {
    outcome: "unknown",
    journal: journal
      ? toIntegrityJournal(journal)
      : {
          appliedCount: 0,
          repositoryCount: readDrizzleJournal().entries.length,
          pendingMigrations: [],
          journalStatus: "inaccessible",
        },
    checks: [],
    diagnostics: [message, ...formatDiagnostics("unknown", false, [])],
  };
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase();
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code.toUpperCase()
      : "";
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "CONNECT_TIMEOUT" ||
    message.includes("econnrefused") ||
    message.includes("connect_timeout") ||
    message.includes("connection refused") ||
    message.includes("timeout expired") ||
    message.includes("the server does not support ssl")
  );
}
