import type {
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyPort,
  InferenceBudgetPolicyRecordV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetPolicyVersionRecordV1,
  InferenceBudgetRuntimePolicyV1,
  WorkspaceId,
  WorkspaceInferenceBudgetActivationV1,
} from "@osva-ai/contracts";
import { INFERENCE_BUDGET_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import type {
  InferenceBudgetPolicyRepository,
  InferenceBudgetPolicyVersionAppend,
  WorkspaceInferenceBudgetActivationUpsertInput,
} from "@osva/domain";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../database.js";
import { securityAuditEventToRow } from "../mappers/identity-mapper.js";
import {
  inferenceBudgetPolicyFromRow,
  inferenceBudgetPolicyVersionFromRow,
  inferenceBudgetRuntimePolicyFromActivation,
} from "../mappers/inference-budget-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { inferenceBudgetPolicies } from "../schema/inference-budget-policies.js";
import { inferenceBudgetPolicyVersions } from "../schema/inference-budget-policy-versions.js";
import { securityAuditEvents } from "../schema/security-audit-events.js";
import { workspaceInferenceBudgetActivation } from "../schema/workspace-inference-budget-activation.js";

export interface InferenceBudgetPolicyInsert {
  readonly id: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly createdAt: Date;
}

export interface InferenceBudgetPolicyVersionInsert {
  readonly id: InferenceBudgetPolicyVersionId;
  readonly policyId: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
  readonly createdAt: Date;
}

export interface WorkspaceInferenceBudgetActivationUpsert {
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly activePolicyVersionId?: InferenceBudgetPolicyVersionId;
  readonly updatedAt: Date;
}

export class PostgresInferenceBudgetPolicyRepository
  implements InferenceBudgetPolicyPort, InferenceBudgetPolicyRepository
{
  constructor(private readonly database: Database) {}

  async savePolicy(policy: InferenceBudgetPolicyInsert): Promise<void> {
    try {
      await this.database.db.insert(inferenceBudgetPolicies).values({
        id: policy.id,
        workspaceId: policy.workspaceId,
        key: policy.key,
        createdAt: policy.createdAt,
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async savePolicyVersion(
    version: InferenceBudgetPolicyVersionInsert,
  ): Promise<void> {
    try {
      await this.database.db.insert(inferenceBudgetPolicyVersions).values({
        id: version.id,
        policyId: version.policyId,
        workspaceId: version.workspaceId,
        version: version.version,
        definitionJson: version.definition,
        createdAt: version.createdAt,
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async upsertWorkspaceActivation(
    input: WorkspaceInferenceBudgetActivationUpsert,
  ): Promise<void> {
    try {
      await this.database.db
        .insert(workspaceInferenceBudgetActivation)
        .values({
          workspaceId: input.workspaceId,
          enabled: input.enabled,
          activePolicyVersionId: input.activePolicyVersionId,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: workspaceInferenceBudgetActivation.workspaceId,
          set: {
            enabled: input.enabled,
            activePolicyVersionId: input.activePolicyVersionId,
            updatedAt: input.updatedAt,
          },
        });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async upsertWorkspaceActivationWithAudit(
    input: WorkspaceInferenceBudgetActivationUpsertInput,
  ): Promise<void> {
    const auditRow = securityAuditEventToRow(input.auditEvent);
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${input.workspaceId} || ':ib-activation'))`,
        );
        await tx
          .insert(workspaceInferenceBudgetActivation)
          .values({
            workspaceId: input.workspaceId,
            enabled: input.enabled,
            activePolicyVersionId: input.activePolicyVersionId ?? null,
            updatedAt: input.updatedAt,
          })
          .onConflictDoUpdate({
            target: workspaceInferenceBudgetActivation.workspaceId,
            set: {
              enabled: input.enabled,
              activePolicyVersionId: input.activePolicyVersionId ?? null,
              updatedAt: input.updatedAt,
            },
          });
        await tx.insert(securityAuditEvents).values(auditRow);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<InferenceBudgetPolicyRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(inferenceBudgetPolicies)
      .where(
        and(
          eq(inferenceBudgetPolicies.workspaceId, workspaceId),
          eq(inferenceBudgetPolicies.id, policyId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetPolicyFromRow(row);
  }

  async listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceBudgetPolicyRecordV1[]> {
    const rows = await this.database.db
      .select()
      .from(inferenceBudgetPolicies)
      .where(eq(inferenceBudgetPolicies.workspaceId, workspaceId))
      .orderBy(inferenceBudgetPolicies.key);
    return rows.map(inferenceBudgetPolicyFromRow);
  }

  async findPolicyVersionById(
    workspaceId: WorkspaceId,
    policyVersionId: InferenceBudgetPolicyVersionId,
  ): Promise<InferenceBudgetPolicyVersionRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(inferenceBudgetPolicyVersions)
      .where(
        and(
          eq(inferenceBudgetPolicyVersions.workspaceId, workspaceId),
          eq(inferenceBudgetPolicyVersions.id, policyVersionId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetPolicyVersionFromRow(row);
  }

  async listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<readonly InferenceBudgetPolicyVersionRecordV1[]> {
    const rows = await this.database.db
      .select()
      .from(inferenceBudgetPolicyVersions)
      .where(
        and(
          eq(inferenceBudgetPolicyVersions.workspaceId, workspaceId),
          eq(inferenceBudgetPolicyVersions.policyId, policyId),
        ),
      )
      .orderBy(desc(inferenceBudgetPolicyVersions.version));
    return rows.map(inferenceBudgetPolicyVersionFromRow);
  }

  async appendPolicyVersion(
    version: InferenceBudgetPolicyVersionAppend,
  ): Promise<InferenceBudgetPolicyVersionRecordV1> {
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${version.workspaceId} || ':ibpv:' || ${version.policyId}))`,
        );
        const [row] = await tx
          .select({
            maxVersion: sql<number>`coalesce(max(${inferenceBudgetPolicyVersions.version}), 0)`,
          })
          .from(inferenceBudgetPolicyVersions)
          .where(
            and(
              eq(
                inferenceBudgetPolicyVersions.workspaceId,
                version.workspaceId,
              ),
              eq(inferenceBudgetPolicyVersions.policyId, version.policyId),
            ),
          );
        const nextVersion = (row?.maxVersion ?? 0) + 1;
        await tx.insert(inferenceBudgetPolicyVersions).values({
          id: version.id,
          policyId: version.policyId,
          workspaceId: version.workspaceId,
          version: nextVersion,
          definitionJson: version.definition,
          createdAt: version.createdAt,
        });
        const [inserted] = await tx
          .select()
          .from(inferenceBudgetPolicyVersions)
          .where(
            and(
              eq(
                inferenceBudgetPolicyVersions.workspaceId,
                version.workspaceId,
              ),
              eq(inferenceBudgetPolicyVersions.id, version.id),
            ),
          )
          .limit(1);
        if (inserted === undefined) {
          throw new Error(
            "Failed to read appended inference budget policy version.",
          );
        }
        return inferenceBudgetPolicyVersionFromRow(inserted);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<number> {
    const [row] = await this.database.db
      .select({
        maxVersion: sql<number>`coalesce(max(${inferenceBudgetPolicyVersions.version}), 0)`,
      })
      .from(inferenceBudgetPolicyVersions)
      .where(
        and(
          eq(inferenceBudgetPolicyVersions.workspaceId, workspaceId),
          eq(inferenceBudgetPolicyVersions.policyId, policyId),
        ),
      );
    return row?.maxVersion ?? 0;
  }

  async findWorkspaceActivation(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceInferenceBudgetActivationV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(workspaceInferenceBudgetActivation)
      .where(eq(workspaceInferenceBudgetActivation.workspaceId, workspaceId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return {
      schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
      workspaceId,
      enabled: row.enabled,
      activePolicyVersionId:
        row.activePolicyVersionId === null
          ? undefined
          : (row.activePolicyVersionId as InferenceBudgetPolicyVersionId),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceBudgetRuntimePolicyV1 | null> {
    const [activation] = await this.database.db
      .select()
      .from(workspaceInferenceBudgetActivation)
      .where(eq(workspaceInferenceBudgetActivation.workspaceId, workspaceId))
      .limit(1);

    if (activation === undefined) {
      return null;
    }

    let versionRow;
    if (activation.activePolicyVersionId !== null) {
      const [row] = await this.database.db
        .select()
        .from(inferenceBudgetPolicyVersions)
        .where(
          and(
            eq(inferenceBudgetPolicyVersions.workspaceId, workspaceId),
            eq(
              inferenceBudgetPolicyVersions.id,
              activation.activePolicyVersionId,
            ),
          ),
        )
        .limit(1);
      versionRow = row;
    }

    return inferenceBudgetRuntimePolicyFromActivation({
      activation,
      version: versionRow,
    });
  }
}
