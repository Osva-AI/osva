import type {
  ApiKeyId,
  ApprovalRequestId,
  SecurityAuditEventId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  COMMUNITY_EDITION_ROLES,
  SECURITY_AUDIT_EVENT_TYPES,
} from "@osva-ai/contracts";
import {
  ApiKey,
  ApprovalRequest,
  generateApiKeySecretMaterial,
  LifecycleConflictError,
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
  buildApiKeyCreatedAuditEvent,
  buildApiKeyRevokedAuditEvent,
  buildApprovalRequestDecidedAuditEvent,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresApiKeyRepository } from "../../src/repositories/postgres-api-key-repository.js";
import { PostgresApprovalRequestRepository } from "../../src/repositories/postgres-approval-request-repository.js";
import { PostgresSecurityAuditEventRepository } from "../../src/repositories/postgres-identity-repositories.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, LATER, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

async function countAuditEvents(
  database: Database,
  workspaceId: WorkspaceId,
): Promise<number> {
  const rows = await database.sql`
    SELECT COUNT(*)::int AS count
    FROM security_audit_events
    WHERE workspace_id = ${workspaceId}
  `;
  return rows[0]?.count ?? 0;
}

describe("PostgreSQL audited control-plane mutations", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let apiKeys: PostgresApiKeyRepository;
  let approvals: PostgresApprovalRequestRepository;
  let auditEvents: PostgresSecurityAuditEventRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    apiKeys = new PostgresApiKeyRepository(database);
    approvals = new PostgresApprovalRequestRepository(database);
    auditEvents = new PostgresSecurityAuditEventRepository(database);
    workflows = new PostgresWorkflowRepository(database);
    workflowRuns = new PostgresWorkflowRunRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("commits API key creation and audit in one transaction", async () => {
    const workspaceId = "ws-audit-create" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const apiKeyId = "ak-audit-create" as ApiKeyId;
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId,
      name: "ops",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      now: NOW,
    });
    const secretMaterial = generateApiKeySecretMaterial(apiKeyId);
    const auditEvent = buildApiKeyCreatedAuditEvent({
      id: "audit-create-1" as SecurityAuditEventId,
      occurredAt: NOW,
      workspaceId,
      actorSubjectId: "subject-admin",
      apiKeyId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    await apiKeys.createWithAudit({
      record: { apiKey, secretDigest: secretMaterial.secretDigest },
      auditEvent,
    });

    expect(await apiKeys.findById(apiKeyId)).not.toBeNull();
    expect(await countAuditEvents(database, workspaceId)).toBe(1);

    const listed = await auditEvents.listForWorkspace(workspaceId, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.eventType).toBe(
      SECURITY_AUDIT_EVENT_TYPES.API_KEY_CREATED,
    );
    expect(JSON.stringify(listed[0]?.details)).not.toContain(
      secretMaterial.plaintextToken,
    );
    expect(JSON.stringify(listed[0]?.details)).not.toContain("secret");
  });

  it("rolls back API key creation when audit insert fails", async () => {
    const workspaceId = "ws-audit-create-fail" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const collisionId = "audit-collision" as SecurityAuditEventId;
    await auditEvents.append(
      buildApiKeyCreatedAuditEvent({
        id: collisionId,
        occurredAt: NOW,
        workspaceId,
        actorSubjectId: "seed",
        apiKeyId: "ak-seed" as ApiKeyId,
        role: COMMUNITY_EDITION_ROLES.VIEWER,
      }),
    );

    const apiKeyId = "ak-rollback" as ApiKeyId;
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId,
      name: "rollback",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      now: NOW,
    });
    const secretMaterial = generateApiKeySecretMaterial(apiKeyId);

    await expect(
      apiKeys.createWithAudit({
        record: { apiKey, secretDigest: secretMaterial.secretDigest },
        auditEvent: buildApiKeyCreatedAuditEvent({
          id: collisionId,
          occurredAt: LATER,
          workspaceId,
          actorSubjectId: "subject-admin",
          apiKeyId,
          role: COMMUNITY_EDITION_ROLES.ADMIN,
        }),
      }),
    ).rejects.toThrow();

    expect(await apiKeys.findById(apiKeyId)).toBeNull();
    expect(await countAuditEvents(database, workspaceId)).toBe(1);
  });

  it("commits revocation and audit atomically; idempotent revoke skips audit", async () => {
    const workspaceId = "ws-audit-revoke" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const apiKeyId = "ak-revoke-audit" as ApiKeyId;
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId,
      name: "revoke-me",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      now: NOW,
    });
    const secretMaterial = generateApiKeySecretMaterial(apiKeyId);
    await apiKeys.createWithAudit({
      record: { apiKey, secretDigest: secretMaterial.secretDigest },
      auditEvent: buildApiKeyCreatedAuditEvent({
        id: "audit-revoke-create" as SecurityAuditEventId,
        occurredAt: NOW,
        workspaceId,
        actorSubjectId: "subject-admin",
        apiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    });

    const revoked = await apiKeys.revokeWithAudit({
      workspaceId,
      apiKeyId,
      revokedAt: LATER,
      auditEvent: buildApiKeyRevokedAuditEvent({
        id: "audit-revoke-1" as SecurityAuditEventId,
        occurredAt: LATER,
        workspaceId,
        actorSubjectId: "subject-admin",
        apiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    });
    expect(revoked.revokedAt).toEqual(LATER);

    await apiKeys.revokeWithAudit({
      workspaceId,
      apiKeyId,
      revokedAt: LATER,
      auditEvent: buildApiKeyRevokedAuditEvent({
        id: "audit-revoke-dup" as SecurityAuditEventId,
        occurredAt: LATER,
        workspaceId,
        actorSubjectId: "subject-admin",
        apiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    });

    expect(await countAuditEvents(database, workspaceId)).toBe(2);
    const listed = await auditEvents.listForWorkspace(workspaceId, 10);
    const revokeEvents = listed.filter(
      (event) => event.eventType === SECURITY_AUDIT_EVENT_TYPES.API_KEY_REVOKED,
    );
    expect(revokeEvents).toHaveLength(1);
  });

  it("rolls back revocation when audit insert fails", async () => {
    const workspaceId = "ws-revoke-rollback" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const apiKeyId = "ak-revoke-rollback" as ApiKeyId;
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId,
      name: "active",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      now: NOW,
    });
    const secretMaterial = generateApiKeySecretMaterial(apiKeyId);
    await apiKeys.create({
      apiKey,
      secretDigest: secretMaterial.secretDigest,
    });

    const collisionId = "audit-revoke-collision" as SecurityAuditEventId;
    await auditEvents.append(
      buildApiKeyRevokedAuditEvent({
        id: collisionId,
        occurredAt: NOW,
        workspaceId,
        actorSubjectId: "seed",
        apiKeyId: "ak-other" as ApiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    );

    await expect(
      apiKeys.revokeWithAudit({
        workspaceId,
        apiKeyId,
        revokedAt: LATER,
        auditEvent: buildApiKeyRevokedAuditEvent({
          id: collisionId,
          occurredAt: LATER,
          workspaceId,
          actorSubjectId: "subject-admin",
          apiKeyId,
          role: COMMUNITY_EDITION_ROLES.ADMIN,
        }),
      }),
    ).rejects.toThrow();

    const loaded = await apiKeys.findById(apiKeyId);
    expect(loaded?.apiKey.revokedAt).toBeUndefined();
  });

  it("scopes audit listing to workspace", async () => {
    const wsA = "ws-audit-a" as WorkspaceId;
    const wsB = "ws-audit-b" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: wsA, name: "A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: wsB, name: "B", createdAt: NOW }),
    );

    await auditEvents.append(
      buildApiKeyCreatedAuditEvent({
        id: "audit-ws-a" as SecurityAuditEventId,
        occurredAt: NOW,
        workspaceId: wsA,
        actorSubjectId: "a",
        apiKeyId: "ak-a" as ApiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    );
    await auditEvents.append(
      buildApiKeyCreatedAuditEvent({
        id: "audit-ws-b" as SecurityAuditEventId,
        occurredAt: NOW,
        workspaceId: wsB,
        actorSubjectId: "b",
        apiKeyId: "ak-b" as ApiKeyId,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      }),
    );

    expect(
      (await auditEvents.listForWorkspace(wsA, 10)).map((e) => e.id),
    ).toEqual(["audit-ws-a"]);
    expect(
      (await auditEvents.listForWorkspace(wsB, 10)).map((e) => e.id),
    ).toEqual(["audit-ws-b"]);
  });

  async function seedApprovalGraph(label: string): Promise<{
    workspaceId: WorkspaceId;
    workflowRunId: WorkflowRunId;
    workflowNodeRunId: WorkflowNodeRunId;
  }> {
    const ids = createIds(`audit-${label}`);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    const workflowId = `workflow-audit-${label}` as WorkflowId;
    await workflows.saveWorkflow(
      Workflow.create({
        id: workflowId,
        workspaceId: ids.workspaceId,
        key: `wf-audit-${label}`,
        name: "Workflow",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    const workflowVersionId =
      `workflow-version-audit-${label}` as WorkflowVersionId;
    await workflows.saveWorkflowVersion(
      WorkflowVersion.create({
        id: workflowVersionId,
        workflowId,
        workspaceId: ids.workspaceId,
        version: 1,
        definition: {
          schemaVersion: "2",
          nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
          edges: [],
        },
        createdAt: NOW,
      }),
    );
    const workflowRunId = `workflow-run-audit-${label}` as WorkflowRunId;
    await workflowRuns.saveWorkflowRun(
      WorkflowRun.create({
        id: workflowRunId,
        workspaceId: ids.workspaceId,
        workflowId,
        workflowVersionId,
        input: { campaign: "launch" },
        createdAt: NOW,
      }),
    );
    const workflowNodeRunId = `node-run-audit-${label}` as WorkflowNodeRunId;
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: workflowNodeRunId,
        workspaceId: ids.workspaceId,
        workflowRunId,
        workflowNodeKey: "review",
        sequence: 1,
        input: { campaign: "launch" },
        createdAt: NOW,
      }),
    );
    return {
      workspaceId: ids.workspaceId,
      workflowRunId,
      workflowNodeRunId,
    };
  }

  it("commits approval decision and audit atomically; conflict does not add audit", async () => {
    const seeded = await seedApprovalGraph("decide");
    const workspaceId = seeded.workspaceId;
    const pending = ApprovalRequest.create({
      id: "approval-audit" as ApprovalRequestId,
      workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    const auditEvent = buildApprovalRequestDecidedAuditEvent({
      id: "audit-approval-1" as SecurityAuditEventId,
      occurredAt: LATER,
      workspaceId,
      actorUserId: undefined,
      actorSubjectId: "user-1",
      approvalRequestId: pending.id,
      workflowRunId: pending.workflowRunId,
      workflowNodeRunId: pending.workflowNodeRunId,
      decision: "APPROVED",
    });

    const decided = await approvals.saveApprovalRequestTransitionWithAudit(
      "PENDING",
      pending.markApproved(LATER, "ok"),
      auditEvent,
    );
    expect(decided.status).toBe("APPROVED");
    expect(await countAuditEvents(database, workspaceId)).toBe(1);

    await expect(
      approvals.saveApprovalRequestTransitionWithAudit(
        "PENDING",
        pending.markRejected(LATER, "late"),
        buildApprovalRequestDecidedAuditEvent({
          id: "audit-approval-2" as SecurityAuditEventId,
          occurredAt: LATER,
          workspaceId,
          actorUserId: undefined,
          actorSubjectId: "user-2",
          approvalRequestId: pending.id,
          workflowRunId: pending.workflowRunId,
          workflowNodeRunId: pending.workflowNodeRunId,
          decision: "REJECTED",
        }),
      ),
    ).rejects.toBeInstanceOf(LifecycleConflictError);

    expect(await countAuditEvents(database, workspaceId)).toBe(1);
  });

  it("rolls back approval decision when audit insert fails", async () => {
    const seeded = await seedApprovalGraph("rollback");
    const workspaceId = seeded.workspaceId;
    const pending = ApprovalRequest.create({
      id: "approval-rollback" as ApprovalRequestId,
      workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    const collisionId = "audit-approval-collision" as SecurityAuditEventId;
    await auditEvents.append(
      buildApprovalRequestDecidedAuditEvent({
        id: collisionId,
        occurredAt: NOW,
        workspaceId,
        actorUserId: undefined,
        actorSubjectId: "seed",
        approvalRequestId: "other" as ApprovalRequestId,
        workflowRunId: "wr-x" as never,
        workflowNodeRunId: "wnr-x" as never,
        decision: "REJECTED",
      }),
    );

    await expect(
      approvals.saveApprovalRequestTransitionWithAudit(
        "PENDING",
        pending.markApproved(LATER, "nope"),
        buildApprovalRequestDecidedAuditEvent({
          id: collisionId,
          occurredAt: LATER,
          workspaceId,
          actorUserId: undefined,
          actorSubjectId: "user-1",
          approvalRequestId: pending.id,
          workflowRunId: pending.workflowRunId,
          workflowNodeRunId: pending.workflowNodeRunId,
          decision: "APPROVED",
        }),
      ),
    ).rejects.toThrow();

    const reloaded = await approvals.findApprovalRequestById(pending.id);
    expect(reloaded?.status).toBe("PENDING");
  });

  it("records one audit event when concurrent decisions race", async () => {
    const seeded = await seedApprovalGraph("race");
    const workspaceId = seeded.workspaceId;
    const pending = ApprovalRequest.create({
      id: "approval-race-audit" as ApprovalRequestId,
      workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    const results = await Promise.allSettled([
      approvals.saveApprovalRequestTransitionWithAudit(
        "PENDING",
        pending.markApproved(LATER, "yes"),
        buildApprovalRequestDecidedAuditEvent({
          id: "audit-race-yes" as SecurityAuditEventId,
          occurredAt: LATER,
          workspaceId,
          actorUserId: undefined,
          actorSubjectId: "a",
          approvalRequestId: pending.id,
          workflowRunId: pending.workflowRunId,
          workflowNodeRunId: pending.workflowNodeRunId,
          decision: "APPROVED",
        }),
      ),
      approvals.saveApprovalRequestTransitionWithAudit(
        "PENDING",
        pending.markRejected(LATER, "no"),
        buildApprovalRequestDecidedAuditEvent({
          id: "audit-race-no" as SecurityAuditEventId,
          occurredAt: LATER,
          workspaceId,
          actorUserId: undefined,
          actorSubjectId: "b",
          approvalRequestId: pending.id,
          workflowRunId: pending.workflowRunId,
          workflowNodeRunId: pending.workflowNodeRunId,
          decision: "REJECTED",
        }),
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await countAuditEvents(database, workspaceId)).toBe(1);
  });
});
