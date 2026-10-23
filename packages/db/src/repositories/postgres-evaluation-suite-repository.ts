import type {
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DomainInvariantError,
  DuplicateEvaluationSuiteKeyError,
  EvaluationCase,
  EvaluationGateAssessmentConflictError,
  EvaluationRunNotFoundError,
  LifecycleConflictError,
  assertLegalEvaluationRunTransition,
  EvaluationSuiteVersion,
  type EvaluationCaseResult,
  type EvaluationRun,
  type EvaluationRunGateAssessment,
  type EvaluationSuite,
  type EvaluationSuiteRepository,
  type ListEvaluationRunsQuery,
  type ListEvaluationRunsResult,
} from "@osva/domain";
import { and, asc, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Database, DatabaseSchema } from "../database.js";
import {
  evaluationCaseFromRow,
  evaluationCaseResultFromRow,
  evaluationCaseResultToRow,
  evaluationCaseToRow,
  evaluationRunFromRow,
  evaluationRunGateAssessmentFromRow,
  evaluationRunGateAssessmentToRow,
  evaluationRunToRow,
  evaluationSuiteFromRow,
  isSameEvaluationRunGateAssessment,
  evaluationSuiteToRow,
  evaluationSuiteVersionToRow,
  isSameEvaluationCase,
  isSameEvaluationCaseResult,
  isSameEvaluationSuiteVersion,
} from "../mappers/evaluation-suite-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
  withMappedDatabaseErrors,
} from "../postgres-errors.js";
import { evaluationCaseResults } from "../schema/evaluation-case-results.js";
import { evaluationRunGateAssessments } from "../schema/evaluation-run-gate-assessments.js";
import { evaluationCases } from "../schema/evaluation-cases.js";
import { evaluationRuns } from "../schema/evaluation-runs.js";
import { evaluationSuiteVersions } from "../schema/evaluation-suite-versions.js";
import { evaluationSuites } from "../schema/evaluation-suites.js";

export class PostgresEvaluationSuiteRepository implements EvaluationSuiteRepository {
  constructor(private readonly database: Database) {}

  async saveSuite(suite: EvaluationSuite): Promise<void> {
    const row = evaluationSuiteToRow(suite);

    try {
      await this.database.db
        .insert(evaluationSuites)
        .values(row)
        .onConflictDoUpdate({
          target: evaluationSuites.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            description: row.description,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "evaluation_suites_workspace_id_key_unique"
      ) {
        throw new DuplicateEvaluationSuiteKeyError(
          suite.workspaceId,
          suite.key,
        );
      }

      throw mapDatabaseError(error, {
        evaluation_suites_workspace_id_key_unique: `EvaluationSuite key '${suite.key}' already exists in workspace '${suite.workspaceId}'.`,
      });
    }
  }

  async findSuiteById(id: EvaluationSuiteId): Promise<EvaluationSuite | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationSuites)
      .where(eq(evaluationSuites.id, id))
      .limit(1);

    return row === undefined ? null : evaluationSuiteFromRow(row);
  }

  async findSuiteByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationSuiteId,
  ): Promise<EvaluationSuite | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationSuites)
      .where(
        and(
          eq(evaluationSuites.id, id),
          eq(evaluationSuites.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : evaluationSuiteFromRow(row);
  }

  async listSuitesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly EvaluationSuite[]> {
    const rows = await this.database.db
      .select()
      .from(evaluationSuites)
      .where(eq(evaluationSuites.workspaceId, workspaceId))
      .orderBy(asc(evaluationSuites.createdAt), asc(evaluationSuites.id));

    return rows.map(evaluationSuiteFromRow);
  }

  async saveSuiteVersion(version: EvaluationSuiteVersion): Promise<void> {
    const existing = await this.findSuiteVersionById(version.id);

    if (existing) {
      if (isSameEvaluationSuiteVersion(existing, version)) {
        return;
      }

      throw new DomainInvariantError(
        `EvaluationSuiteVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    await this.database.db.transaction(async (tx) => {
      try {
        await tx
          .insert(evaluationSuiteVersions)
          .values(evaluationSuiteVersionToRow(version));
      } catch (error) {
        if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
          const constraint = postgresConstraintName(error);

          if (
            constraint === "evaluation_suite_versions_id_pk" ||
            constraint === "evaluation_suite_versions_pkey"
          ) {
            const stored = await this.findSuiteVersionById(version.id);
            if (stored && isSameEvaluationSuiteVersion(stored, version)) {
              return;
            }

            throw new DomainInvariantError(
              `EvaluationSuiteVersion '${version.id}' is immutable and cannot be replaced with different content.`,
            );
          }

          if (
            constraint === "evaluation_suite_versions_suite_id_version_unique"
          ) {
            throw new DomainInvariantError(
              `EvaluationSuiteVersion already exists for suite '${version.evaluationSuiteId}' version ${String(version.version)}.`,
            );
          }
        }

        throw mapDatabaseError(error, {
          evaluation_suite_versions_suite_id_version_unique: `EvaluationSuiteVersion already exists for suite '${version.evaluationSuiteId}' version ${String(version.version)}.`,
        });
      }

      for (const evaluationCase of version.cases) {
        await this.insertEvaluationCase(tx, evaluationCase);
      }
    });
  }

  async findSuiteVersionById(
    id: EvaluationSuiteVersionId,
  ): Promise<EvaluationSuiteVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationSuiteVersions)
      .where(eq(evaluationSuiteVersions.id, id))
      .limit(1);

    if (row === undefined) {
      return null;
    }

    const caseRows = await this.database.db
      .select()
      .from(evaluationCases)
      .where(eq(evaluationCases.evaluationSuiteVersionId, id))
      .orderBy(asc(evaluationCases.key));

    return EvaluationSuiteVersion.rehydrate({
      id: row.id as EvaluationSuiteVersionId,
      evaluationSuiteId: row.evaluationSuiteId as EvaluationSuiteId,
      workspaceId: row.workspaceId as WorkspaceId,
      version: row.version,
      createdAt: row.createdAt,
      cases: caseRows.map(evaluationCaseFromRow),
    });
  }

  async listSuiteVersionsBySuite(
    evaluationSuiteId: EvaluationSuiteId,
  ): Promise<readonly EvaluationSuiteVersion[]> {
    const rows = await this.database.db
      .select()
      .from(evaluationSuiteVersions)
      .where(eq(evaluationSuiteVersions.evaluationSuiteId, evaluationSuiteId))
      .orderBy(asc(evaluationSuiteVersions.version));

    const versions = await Promise.all(
      rows.map(async (row) =>
        this.findSuiteVersionById(row.id as EvaluationSuiteVersionId),
      ),
    );

    return versions.filter(
      (version): version is EvaluationSuiteVersion => version !== null,
    );
  }

  async saveEvaluationRun(evaluationRun: EvaluationRun): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(evaluationRuns)
          .values(evaluationRunToRow(evaluationRun)),
      {
        evaluation_runs_pkey: `An EvaluationRun with id '${evaluationRun.id}' already exists.`,
      },
    );
  }

  async listEvaluationRuns(
    query: ListEvaluationRunsQuery,
  ): Promise<ListEvaluationRunsResult> {
    const conditions: SQL[] = [
      eq(evaluationRuns.workspaceId, query.workspaceId),
    ];

    if (query.evaluationSuiteVersionId !== undefined) {
      conditions.push(
        eq(
          evaluationRuns.evaluationSuiteVersionId,
          query.evaluationSuiteVersionId,
        ),
      );
    } else if (query.evaluationSuiteId !== undefined) {
      const versionRows = await this.database.db
        .select({ id: evaluationSuiteVersions.id })
        .from(evaluationSuiteVersions)
        .where(
          and(
            eq(
              evaluationSuiteVersions.evaluationSuiteId,
              query.evaluationSuiteId,
            ),
            eq(evaluationSuiteVersions.workspaceId, query.workspaceId),
          ),
        );

      const versionIds = versionRows.map((row) => row.id);
      if (versionIds.length === 0) {
        return { evaluationRuns: [] };
      }

      conditions.push(
        inArray(evaluationRuns.evaluationSuiteVersionId, versionIds),
      );
    }

    if (query.agentVersionId !== undefined) {
      conditions.push(eq(evaluationRuns.targetType, "AGENT_VERSION"));
      conditions.push(eq(evaluationRuns.targetVersionId, query.agentVersionId));
    }

    if (query.status !== undefined) {
      conditions.push(eq(evaluationRuns.status, query.status));
    }

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(evaluationRuns.createdAt, query.cursor.createdAt),
        and(
          eq(evaluationRuns.createdAt, query.cursor.createdAt),
          lt(evaluationRuns.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(evaluationRuns)
      .where(and(...conditions))
      .orderBy(desc(evaluationRuns.createdAt), desc(evaluationRuns.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      evaluationRuns: page.map(evaluationRunFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id as EvaluationRunId }
          : undefined,
    };
  }

  async findEvaluationRunById(
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, id))
      .limit(1);

    return row === undefined ? null : evaluationRunFromRow(row);
  }

  async findEvaluationRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationRuns)
      .where(
        and(
          eq(evaluationRuns.id, id),
          eq(evaluationRuns.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : evaluationRunFromRow(row);
  }

  async transitionEvaluationRun(
    expectedStatus: EvaluationRunState,
    next: EvaluationRun,
  ): Promise<EvaluationRun> {
    assertLegalEvaluationRunTransition(expectedStatus, next.status);
    const rowValues = evaluationRunToRow(next);

    const [row] = await this.database.db
      .update(evaluationRuns)
      .set({
        status: rowValues.status,
        startedAt: rowValues.startedAt,
        completedAt: rowValues.completedAt,
        cancelledAt: rowValues.cancelledAt,
        updatedAt: rowValues.updatedAt,
      })
      .where(
        and(
          eq(evaluationRuns.id, next.id),
          eq(evaluationRuns.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return evaluationRunFromRow(row);
    }

    const existing = await this.findEvaluationRunById(next.id);
    if (existing === null) {
      throw new EvaluationRunNotFoundError(next.id);
    }

    throw new LifecycleConflictError("evaluationRun", next.id, expectedStatus);
  }

  async saveCaseResult(result: EvaluationCaseResult): Promise<void> {
    const existing = await this.findCaseResultByRunAndCase(
      result.evaluationRunId,
      result.evaluationCaseId,
    );

    if (existing) {
      if (isSameEvaluationCaseResult(existing, result)) {
        return;
      }

      throw new DomainInvariantError(
        `EvaluationCaseResult for run '${result.evaluationRunId}' and case '${result.evaluationCaseId}' is immutable and cannot be replaced with different content.`,
      );
    }

    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(evaluationCaseResults)
          .values(evaluationCaseResultToRow(result)),
      {
        evaluation_case_results_pkey: `An EvaluationCaseResult with id '${result.id}' already exists.`,
        evaluation_case_results_run_id_case_id_unique: `EvaluationCaseResult already exists for run '${result.evaluationRunId}' and case '${result.evaluationCaseId}'.`,
      },
    );
  }

  async findCaseResultByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationCaseResult | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationCaseResults)
      .where(
        and(
          eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
          eq(evaluationCaseResults.evaluationCaseId, evaluationCaseId),
        ),
      )
      .limit(1);

    return row === undefined ? null : evaluationCaseResultFromRow(row);
  }

  async listCaseResultsByEvaluationRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly EvaluationCaseResult[]> {
    const rows = await this.database.db
      .select()
      .from(evaluationCaseResults)
      .where(eq(evaluationCaseResults.evaluationRunId, evaluationRunId))
      .orderBy(
        asc(evaluationCaseResults.createdAt),
        asc(evaluationCaseResults.id),
      );

    return rows.map(evaluationCaseResultFromRow);
  }

  async findCaseById(id: EvaluationCaseId): Promise<EvaluationCase | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationCases)
      .where(eq(evaluationCases.id, id))
      .limit(1);

    return row === undefined ? null : evaluationCaseFromRow(row);
  }

  async saveGateAssessment(
    assessment: EvaluationRunGateAssessment,
  ): Promise<void> {
    const existing = await this.findGateAssessmentByEvaluationRunId(
      assessment.evaluationRunId,
    );
    if (existing !== null) {
      if (isSameEvaluationRunGateAssessment(existing, assessment)) {
        return;
      }
      throw new EvaluationGateAssessmentConflictError(
        assessment.evaluationRunId,
      );
    }

    try {
      await this.database.db
        .insert(evaluationRunGateAssessments)
        .values(evaluationRunGateAssessmentToRow(assessment));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const stored = await this.findGateAssessmentByEvaluationRunId(
          assessment.evaluationRunId,
        );
        if (
          stored !== null &&
          isSameEvaluationRunGateAssessment(stored, assessment)
        ) {
          return;
        }
        throw new EvaluationGateAssessmentConflictError(
          assessment.evaluationRunId,
        );
      }
      throw mapDatabaseError(error, {
        evaluation_run_gate_assessments_pkey: `EvaluationRunGateAssessment already exists for run '${assessment.evaluationRunId}'.`,
      });
    }
  }

  async findGateAssessmentByEvaluationRunId(
    evaluationRunId: EvaluationRunId,
  ): Promise<EvaluationRunGateAssessment | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationRunGateAssessments)
      .where(eq(evaluationRunGateAssessments.evaluationRunId, evaluationRunId))
      .limit(1);

    return row === undefined ? null : evaluationRunGateAssessmentFromRow(row);
  }

  async findGateAssessmentByWorkspaceAndEvaluationRunId(
    workspaceId: WorkspaceId,
    evaluationRunId: EvaluationRunId,
  ): Promise<EvaluationRunGateAssessment | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationRunGateAssessments)
      .where(
        and(
          eq(evaluationRunGateAssessments.evaluationRunId, evaluationRunId),
          eq(evaluationRunGateAssessments.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : evaluationRunGateAssessmentFromRow(row);
  }

  private async insertEvaluationCase(
    tx: PostgresJsDatabase<DatabaseSchema>,
    evaluationCase: EvaluationCase,
  ): Promise<void> {
    try {
      await tx
        .insert(evaluationCases)
        .values(evaluationCaseToRow(evaluationCase));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "evaluation_cases_id_pk" ||
          constraint === "evaluation_cases_pkey"
        ) {
          const stored = await this.findCaseById(evaluationCase.id);
          if (stored && isSameEvaluationCase(stored, evaluationCase)) {
            return;
          }

          throw new DomainInvariantError(
            `EvaluationCase '${evaluationCase.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (constraint === "evaluation_cases_version_id_key_unique") {
          throw new DomainInvariantError(
            `EvaluationCase key '${evaluationCase.key}' already exists in suite version '${evaluationCase.evaluationSuiteVersionId}'.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        evaluation_cases_version_id_key_unique: `EvaluationCase key '${evaluationCase.key}' already exists in suite version '${evaluationCase.evaluationSuiteVersionId}'.`,
      });
    }
  }
}
