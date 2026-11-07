import type { WorkspaceId } from "@osva-ai/contracts";
import {
  BuilderPublicationIdempotencyConflictError,
  DomainInvariantError,
  type BuilderPublicationAtomicPersistInput,
  type BuilderPublicationRecordV1,
  type BuilderPublicationRepository,
} from "@osva/domain";

import { and, eq } from "drizzle-orm";

import { builderPublicationAdvisoryXactLock } from "../builder-publication-advisory-lock.js";
import type { Database } from "../database.js";
import { agentVersionToRow } from "../mappers/agent-version-mapper.js";
import { agentToRow } from "../mappers/agent-mapper.js";
import {
  builderPublicationFromRow,
  builderPublicationToRow,
} from "../mappers/builder-publication-mapper.js";
import { securityAuditEventToRow } from "../mappers/identity-mapper.js";
import { workflowVersionToRow } from "../mappers/workflow-version-mapper.js";
import { workflowToRow } from "../mappers/workflow-mapper.js";
import {
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
  POSTGRES_UNIQUE_VIOLATION,
} from "../postgres-errors.js";
import { agentVersions } from "../schema/agent-versions.js";
import { agents } from "../schema/agents.js";
import { builderPublications } from "../schema/builder-publications.js";
import { securityAuditEvents } from "../schema/security-audit-events.js";
import { workflowVersions } from "../schema/workflow-versions.js";
import { workflows } from "../schema/workflows.js";

const BUILDER_PUBLICATION_IDEMPOTENCY_UNIQUE =
  "builder_publications_workspace_id_idempotency_key_unique";

const PUBLICATION_REPLAY_UNIQUE_CONSTRAINTS = new Set<string>([
  BUILDER_PUBLICATION_IDEMPOTENCY_UNIQUE,
  "agents_workspace_id_key_unique",
  "workflows_workspace_id_key_unique",
]);

export class PostgresBuilderPublicationRepository implements BuilderPublicationRepository {
  constructor(private readonly database: Database) {}

  async findByWorkspaceAndIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<BuilderPublicationRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(builderPublications)
      .where(
        and(
          eq(builderPublications.workspaceId, workspaceId),
          eq(builderPublications.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : builderPublicationFromRow(row);
  }

  async findByWorkspaceAndPublicationId(
    workspaceId: string,
    publicationId: string,
  ): Promise<BuilderPublicationRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(builderPublications)
      .where(
        and(
          eq(builderPublications.workspaceId, workspaceId),
          eq(builderPublications.id, publicationId),
        ),
      )
      .limit(1);

    return row === undefined ? null : builderPublicationFromRow(row);
  }

  private resolveIdempotentReplayOrConflict(
    input: BuilderPublicationAtomicPersistInput,
    stored: BuilderPublicationRecordV1 | null,
    uniqueViolation: unknown,
  ): { readonly replay: boolean } {
    if (stored === null) {
      throw mapDatabaseError(uniqueViolation);
    }
    if (stored.planDigest !== input.publication.planDigest) {
      throw new BuilderPublicationIdempotencyConflictError(
        input.publication.workspaceId as WorkspaceId,
        input.publication.idempotencyKey,
      );
    }
    return { replay: true };
  }

  async publishAtomically(
    input: BuilderPublicationAtomicPersistInput,
  ): Promise<{ readonly replay: boolean }> {
    const publicationRow = builderPublicationToRow(input.publication);
    const auditRow = securityAuditEventToRow(input.auditEvent);

    let replay = false;

    try {
      await this.database.db.transaction(async (tx) => {
        await tx.execute(
          builderPublicationAdvisoryXactLock(
            input.publication.workspaceId,
            input.publication.idempotencyKey,
          ),
        );

        const [existing] = await tx
          .select()
          .from(builderPublications)
          .where(
            and(
              eq(
                builderPublications.workspaceId,
                input.publication.workspaceId,
              ),
              eq(
                builderPublications.idempotencyKey,
                input.publication.idempotencyKey,
              ),
            ),
          )
          .for("update")
          .limit(1);

        if (existing !== undefined) {
          if (existing.planDigest !== input.publication.planDigest) {
            throw new BuilderPublicationIdempotencyConflictError(
              input.publication.workspaceId as WorkspaceId,
              input.publication.idempotencyKey,
            );
          }
          replay = true;
          return;
        }

        for (const agent of input.newAgents) {
          await tx.insert(agents).values(agentToRow(agent));
        }
        await input.testHooks?.afterNewAgentsPersisted?.();

        for (const version of input.newAgentVersions) {
          await tx.insert(agentVersions).values(agentVersionToRow(version));
        }
        await input.testHooks?.afterNewAgentVersionsPersisted?.();

        await input.testHooks?.beforeWorkflowPersisted?.();

        await tx.insert(workflows).values(workflowToRow(input.workflow));
        await tx
          .insert(workflowVersions)
          .values(workflowVersionToRow(input.workflowVersion));

        await input.testHooks?.beforeReceiptPersisted?.();

        await tx.insert(builderPublications).values(publicationRow);

        await input.testHooks?.beforeAuditPersisted?.();

        await tx.insert(securityAuditEvents).values(auditRow);
      });
    } catch (error) {
      if (error instanceof BuilderPublicationIdempotencyConflictError) {
        throw error;
      }

      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);
        if (
          constraint !== undefined &&
          PUBLICATION_REPLAY_UNIQUE_CONSTRAINTS.has(constraint)
        ) {
          const stored = await this.findByWorkspaceAndIdempotencyKey(
            input.publication.workspaceId,
            input.publication.idempotencyKey,
          );
          return this.resolveIdempotentReplayOrConflict(input, stored, error);
        }

        throw mapDatabaseError(error);
      }

      if (error instanceof DomainInvariantError) {
        throw error;
      }

      throw mapDatabaseError(error);
    }

    if (replay) {
      return { replay: true };
    }

    return { replay: false };
  }
}
