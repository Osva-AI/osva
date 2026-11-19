import crypto from "node:crypto";

import type { SecurityAuditEventId, WorkspaceId } from "@osva-ai/contracts";
import { SECURITY_AUDIT_EVENT_TYPES } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceInferenceCachePolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "../../src/index.js";
import { SecurityAuditEvent, Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WORKSPACE = "ws-irc-policy" as WorkspaceId;
const NOW = new Date("2026-02-01T00:00:00.000Z");

describe("workspace inference cache policy (0040)", () => {
  let context: PostgresTestContext;
  let database: Database;
  let policies: PostgresWorkspaceInferenceCachePolicyRepository;
  let workspaces: PostgresWorkspaceRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 3,
    });
    await migrateDatabase(database);
    policies = new PostgresWorkspaceInferenceCachePolicyRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({
        id: WORKSPACE,
        name: "Cache policy workspace",
        createdAt: NOW,
      }),
    );
  });

  it("defaults to cache-off when no row exists", async () => {
    await expect(
      policies.findRuntimePolicyByWorkspaceId(WORKSPACE),
    ).resolves.toBeNull();
  });

  it("persists enable, revocation, and revision id", async () => {
    await policies.upsertWithAudit({
      record: {
        schemaVersion: "1",
        workspaceId: WORKSPACE,
        enabled: true,
        determinism: "REQUIRED_DETERMINISTIC",
        updatedAt: NOW.toISOString(),
      },
      auditEvent: audit(),
    });
    const enabled = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    expect(enabled).toMatchObject({
      enabled: true,
      determinism: "REQUIRED_DETERMINISTIC",
      cachePolicyRevisionId: NOW.toISOString(),
    });

    const revokedAt = new Date(NOW.getTime() + 1_000);
    await policies.upsertWithAudit({
      record: {
        schemaVersion: "1",
        workspaceId: WORKSPACE,
        enabled: false,
        determinism: "REQUIRED_DETERMINISTIC",
        revokedAt: revokedAt.toISOString(),
        updatedAt: revokedAt.toISOString(),
      },
      auditEvent: audit(revokedAt),
    });
    const revoked = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    expect(revoked?.enabled).toBe(false);
    expect(revoked?.cachePolicyRevisionId).toBe(revokedAt.toISOString());
  });

  it("cascades policy row on workspace delete", async () => {
    await policies.upsertWithAudit({
      record: {
        schemaVersion: "1",
        workspaceId: WORKSPACE,
        enabled: true,
        determinism: "REQUIRED_DETERMINISTIC",
        updatedAt: NOW.toISOString(),
      },
      auditEvent: audit(),
    });
    await database.sql`DELETE FROM security_audit_events WHERE workspace_id = ${WORKSPACE}`;
    await database.sql`DELETE FROM workspaces WHERE id = ${WORKSPACE}`;
    const rows = await database.sql`
      SELECT workspace_id FROM workspace_inference_cache_policies
      WHERE workspace_id = ${WORKSPACE}
    `;
    expect(rows).toHaveLength(0);
  });
});

function audit(at: Date = NOW) {
  return SecurityAuditEvent.create({
    id: crypto.randomUUID() as SecurityAuditEventId,
    eventType:
      SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_INFERENCE_CACHE_POLICY_UPSERTED,
    occurredAt: at,
    workspaceId: WORKSPACE,
    details: {},
  });
}
