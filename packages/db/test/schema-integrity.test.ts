import { describe, expect, it } from "vitest";

import {
  classifySchemaIntegrity,
  evaluateColumnCheck,
  evaluateIndexCheck,
  formatSchemaIntegrity,
  journalClaimsMigration,
  LEASE_SLICE_COLUMNS,
  LEASE_SLICE_MIGRATION_TAG,
} from "../src/schema-integrity.js";

describe("schema integrity classification", () => {
  const missingChecks = LEASE_SLICE_COLUMNS.map((column) =>
    evaluateColumnCheck(column, undefined),
  );

  it("treats an unclaimed journal and missing objects as not migrated", () => {
    expect(
      classifySchemaIntegrity({
        journalClaimsLeaseSlice: false,
        checks: missingChecks,
      }),
    ).toBe("not_migrated");
  });

  it("treats a claimed journal with matching objects as applied_and_matches", () => {
    const generation = LEASE_SLICE_COLUMNS[1];
    if (generation === undefined) {
      throw new Error("expected lease columns");
    }
    expect(
      classifySchemaIntegrity({
        journalClaimsLeaseSlice: true,
        checks: [
          evaluateColumnCheck(LEASE_SLICE_COLUMNS[0]!, {
            column_name: "execution_owner",
            data_type: "text",
            is_nullable: "YES",
            column_default: null,
          }),
          evaluateColumnCheck(generation, {
            column_name: "execution_generation",
            data_type: "integer",
            is_nullable: "NO",
            column_default: "0",
          }),
          evaluateColumnCheck(LEASE_SLICE_COLUMNS[2]!, {
            column_name: "lease_expires_at",
            data_type: "timestamp with time zone",
            is_nullable: "YES",
            column_default: null,
          }),
          evaluateIndexCheck(
            {
              table: "run_attempts",
              name: "run_attempts_expired_lease_idx",
              definitionIncludes: [
                "lease_expires_at",
                "RUNNING",
                "execution_owner",
              ],
            },
            {
              indexname: "run_attempts_expired_lease_idx",
              indexdef:
                "CREATE INDEX run_attempts_expired_lease_idx ON public.run_attempts USING btree (lease_expires_at) WHERE ((status = 'RUNNING') AND (execution_owner IS NOT NULL))",
            },
          ),
        ],
      }),
    ).toBe("applied_and_matches");
  });

  it("detects the Batch 2 journal-applied but columns-missing incident as schema_mismatch", () => {
    expect(
      classifySchemaIntegrity({
        journalClaimsLeaseSlice: true,
        checks: missingChecks,
      }),
    ).toBe("schema_mismatch");
  });

  it("detects incorrect column definitions", () => {
    const check = evaluateColumnCheck(LEASE_SLICE_COLUMNS[1]!, {
      column_name: "execution_generation",
      data_type: "bigint",
      is_nullable: "YES",
      column_default: null,
    });
    expect(check.ok).toBe(false);
    expect(
      classifySchemaIntegrity({
        journalClaimsLeaseSlice: true,
        checks: [check],
      }),
    ).toBe("schema_mismatch");
  });

  it("classifies matching physical objects without a journal claim as schema_ahead", () => {
    expect(
      classifySchemaIntegrity({
        journalClaimsLeaseSlice: false,
        checks: [
          evaluateColumnCheck(LEASE_SLICE_COLUMNS[0]!, {
            column_name: "execution_owner",
            data_type: "text",
            is_nullable: "YES",
            column_default: null,
          }),
        ],
      }),
    ).toBe("schema_ahead");
  });

  it("claims 0023 only after the journal index is covered", () => {
    const tags = ["0000_start", LEASE_SLICE_MIGRATION_TAG];
    expect(journalClaimsMigration(tags, 1, LEASE_SLICE_MIGRATION_TAG)).toBe(
      false,
    );
    expect(journalClaimsMigration(tags, 2, LEASE_SLICE_MIGRATION_TAG)).toBe(
      true,
    );
  });

  it("formats sanitized diagnostics without connection strings", () => {
    const formatted = formatSchemaIntegrity({
      outcome: "schema_mismatch",
      journal: {
        repositoryHead: LEASE_SLICE_MIGRATION_TAG,
        databaseHead: LEASE_SLICE_MIGRATION_TAG,
        appliedCount: 24,
        repositoryCount: 24,
        pendingMigrations: [],
        journalStatus: "current",
      },
      checks: missingChecks,
      diagnostics: [
        "The migration journal claims 0023_execution_lease_slice is applied, but the physical schema does not match. Do not rerun the migration file automatically.",
      ],
    });
    expect(formatted).toContain("schema_mismatch");
    expect(formatted).not.toContain("postgres://");
    expect(formatted).not.toContain("password");
  });
});
