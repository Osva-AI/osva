import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  SecurityAuditEventId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  SECURITY_AUDIT_EVENT_TYPES,
  createDefaultInferenceBudgetPolicyDefinition,
} from "@osva-ai/contracts";
import {
  Workspace,
  buildInferenceBudgetActivationChangedAuditEvent,
} from "@osva/domain";
import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresInferenceBudgetPolicyRepository } from "../../src/repositories/postgres-inference-budget-policy-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { securityAuditEventToRow } from "../../src/mappers/identity-mapper.js";
import { securityAuditEvents } from "../../src/schema/security-audit-events.js";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WORKSPACE = "ws-budget-audit" as WorkspaceId;
const POLICY_ID = "ibp-audit" as InferenceBudgetPolicyId;
const VERSION_ID = "ibpv-audit" as InferenceBudgetPolicyVersionId;
const NOW = new Date("2026-02-15T12:00:00.000Z");

describe("B5.5C.3 inference budget activation audit atomicity", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let policies: PostgresInferenceBudgetPolicyRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 4,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    policies = new PostgresInferenceBudgetPolicyRepository(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Audit WS", createdAt: NOW }),
    );
    await policies.savePolicy({
      id: POLICY_ID,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    await policies.savePolicyVersion({
      id: VERSION_ID,
      policyId: POLICY_ID,
      workspaceId: WORKSPACE,
      version: 1,
      definition: createDefaultInferenceBudgetPolicyDefinition(),
      createdAt: NOW,
    });
  });

  it("ACT11: audit persistence failure cannot commit activation", async () => {
    const auditId = randomUUID() as SecurityAuditEventId;
    const auditEvent = buildInferenceBudgetActivationChangedAuditEvent({
      id: auditId,
      occurredAt: NOW,
      workspaceId: WORKSPACE,
      actorUserId: undefined,
      actorSubjectId: "subject-test",
      correlationId: "corr-test",
      action: "ACTIVATE",
      previousEnabled: false,
      newEnabled: true,
      newPolicyVersionId: VERSION_ID,
    });
    await database.db
      .insert(securityAuditEvents)
      .values(securityAuditEventToRow(auditEvent));

    await expect(
      policies.upsertWorkspaceActivationWithAudit({
        workspaceId: WORKSPACE,
        enabled: true,
        activePolicyVersionId: VERSION_ID,
        updatedAt: NOW,
        auditEvent,
      }),
    ).rejects.toThrow();

    const activation = await policies.findWorkspaceActivation(WORKSPACE);
    expect(activation).toBeNull();

    const rows = await database.sql`
      SELECT id FROM security_audit_events
      WHERE workspace_id = ${WORKSPACE}
        AND event_type = ${SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_INFERENCE_BUDGET_ACTIVATION_CHANGED}
    `;
    expect(rows.length).toBe(1);
  });
});
