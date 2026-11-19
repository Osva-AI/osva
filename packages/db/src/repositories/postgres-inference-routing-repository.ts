import type {
  InferenceRoutingDecisionId,
  InferenceRoutingDecisionRecordV1,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyRecordV1,
  InferenceRoutingPolicyVersionId,
  InferenceRoutingRuntimePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  InferenceRoutingDecisionInsert,
  InferenceRoutingPolicyInsert,
  InferenceRoutingPolicyRepository,
  InferenceRoutingPolicyVersionInsert,
  WorkspaceInferenceRoutingActivationUpsert,
} from "@osva/domain";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  inferenceRoutingDecisionFromRow,
  inferenceRoutingPolicyFromRow,
  inferenceRoutingPolicyVersionFromRow,
  inferenceRoutingRuntimePolicyFromActivation,
} from "../mappers/inference-routing-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { inferenceRoutingDecisions } from "../schema/inference-routing-decisions.js";
import { inferenceRoutingPolicies } from "../schema/inference-routing-policies.js";
import { inferenceRoutingPolicyVersions } from "../schema/inference-routing-policy-versions.js";
import { workspaceInferenceRoutingActivation } from "../schema/workspace-inference-routing-activation.js";

export class PostgresInferenceRoutingPolicyRepository implements InferenceRoutingPolicyRepository {
  constructor(private readonly database: Database) {}

  async savePolicy(policy: InferenceRoutingPolicyInsert): Promise<void> {
    try {
      await this.database.db.insert(inferenceRoutingPolicies).values({
        id: policy.id,
        workspaceId: policy.workspaceId,
        key: policy.key,
        createdAt: policy.createdAt,
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<InferenceRoutingPolicyRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(inferenceRoutingPolicies)
      .where(
        and(
          eq(inferenceRoutingPolicies.workspaceId, workspaceId),
          eq(inferenceRoutingPolicies.id, policyId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceRoutingPolicyFromRow(row);
  }

  async listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceRoutingPolicyRecordV1[]> {
    const rows = await this.database.db
      .select()
      .from(inferenceRoutingPolicies)
      .where(eq(inferenceRoutingPolicies.workspaceId, workspaceId))
      .orderBy(inferenceRoutingPolicies.key);
    return rows.map(inferenceRoutingPolicyFromRow);
  }

  async savePolicyVersion(
    version: InferenceRoutingPolicyVersionInsert,
  ): Promise<void> {
    try {
      await this.database.db.insert(inferenceRoutingPolicyVersions).values({
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

  async findPolicyVersionById(
    workspaceId: WorkspaceId,
    policyVersionId: InferenceRoutingPolicyVersionId,
  ): Promise<
    import("@osva-ai/contracts").InferenceRoutingPolicyVersionRecordV1 | null
  > {
    const [row] = await this.database.db
      .select()
      .from(inferenceRoutingPolicyVersions)
      .where(
        and(
          eq(inferenceRoutingPolicyVersions.workspaceId, workspaceId),
          eq(inferenceRoutingPolicyVersions.id, policyVersionId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceRoutingPolicyVersionFromRow(row);
  }

  async listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ) {
    const rows = await this.database.db
      .select()
      .from(inferenceRoutingPolicyVersions)
      .where(
        and(
          eq(inferenceRoutingPolicyVersions.workspaceId, workspaceId),
          eq(inferenceRoutingPolicyVersions.policyId, policyId),
        ),
      )
      .orderBy(desc(inferenceRoutingPolicyVersions.version));
    return rows.map(inferenceRoutingPolicyVersionFromRow);
  }

  async getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<number> {
    const [row] = await this.database.db
      .select({
        maxVersion: sql<number>`coalesce(max(${inferenceRoutingPolicyVersions.version}), 0)`,
      })
      .from(inferenceRoutingPolicyVersions)
      .where(
        and(
          eq(inferenceRoutingPolicyVersions.workspaceId, workspaceId),
          eq(inferenceRoutingPolicyVersions.policyId, policyId),
        ),
      );
    return row?.maxVersion ?? 0;
  }

  async upsertWorkspaceActivation(
    input: WorkspaceInferenceRoutingActivationUpsert,
  ): Promise<void> {
    try {
      await this.database.db
        .insert(workspaceInferenceRoutingActivation)
        .values({
          workspaceId: input.workspaceId,
          enabled: input.enabled,
          activePolicyVersionId: input.activePolicyVersionId,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: workspaceInferenceRoutingActivation.workspaceId,
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

  async findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceRoutingRuntimePolicyV1 | null> {
    const [activation] = await this.database.db
      .select()
      .from(workspaceInferenceRoutingActivation)
      .where(eq(workspaceInferenceRoutingActivation.workspaceId, workspaceId))
      .limit(1);

    if (activation === undefined) {
      return null;
    }

    if (!activation.enabled || activation.activePolicyVersionId === null) {
      return inferenceRoutingRuntimePolicyFromActivation({
        activation,
        version: undefined,
      });
    }

    const [version] = await this.database.db
      .select()
      .from(inferenceRoutingPolicyVersions)
      .where(
        and(
          eq(inferenceRoutingPolicyVersions.workspaceId, workspaceId),
          eq(
            inferenceRoutingPolicyVersions.id,
            activation.activePolicyVersionId,
          ),
        ),
      )
      .limit(1);

    return inferenceRoutingRuntimePolicyFromActivation({
      activation,
      version,
    });
  }

  async saveRoutingDecision(
    decision: InferenceRoutingDecisionInsert,
  ): Promise<void> {
    try {
      await this.database.db.insert(inferenceRoutingDecisions).values({
        id: decision.id,
        workspaceId: decision.workspaceId,
        policyVersionId: decision.policyVersionId,
        decisionJson: decision.decision,
        createdAt: decision.createdAt,
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findRoutingDecisionById(
    workspaceId: WorkspaceId,
    decisionId: InferenceRoutingDecisionId,
  ): Promise<InferenceRoutingDecisionRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(inferenceRoutingDecisions)
      .where(
        and(
          eq(inferenceRoutingDecisions.workspaceId, workspaceId),
          eq(inferenceRoutingDecisions.id, decisionId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceRoutingDecisionFromRow(row);
  }
}
