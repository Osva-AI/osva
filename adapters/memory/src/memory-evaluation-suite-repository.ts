import type {
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateEvaluationSuiteKeyError,
  EvaluationRunNotFoundError,
  EvaluationSuiteVersion,
  LifecycleConflictError,
  assertLegalEvaluationRunTransition,
  type EvaluationCase,
  type EvaluationCaseResult,
  type EvaluationRun,
  type EvaluationSuite,
  type EvaluationSuiteRepository,
} from "@osva/domain";

export class MemoryEvaluationSuiteRepository implements EvaluationSuiteRepository {
  private readonly suites = new Map<EvaluationSuiteId, EvaluationSuite>();
  private readonly versions = new Map<
    EvaluationSuiteVersionId,
    EvaluationSuiteVersion
  >();
  private readonly cases = new Map<EvaluationCaseId, EvaluationCase>();
  private readonly evaluationRuns = new Map<EvaluationRunId, EvaluationRun>();
  private readonly caseResults = new Map<
    EvaluationCaseResult["id"],
    EvaluationCaseResult
  >();

  async saveSuite(suite: EvaluationSuite): Promise<void> {
    for (const existing of this.suites.values()) {
      if (
        existing.id !== suite.id &&
        existing.workspaceId === suite.workspaceId &&
        existing.key === suite.key
      ) {
        throw new DuplicateEvaluationSuiteKeyError(
          suite.workspaceId,
          suite.key,
        );
      }
    }

    this.suites.set(suite.id, suite);
  }

  async findSuiteById(id: EvaluationSuiteId): Promise<EvaluationSuite | null> {
    return this.suites.get(id) ?? null;
  }

  async findSuiteByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationSuiteId,
  ): Promise<EvaluationSuite | null> {
    const suite = this.suites.get(id);
    if (suite === undefined || suite.workspaceId !== workspaceId) {
      return null;
    }

    return suite;
  }

  async listSuitesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly EvaluationSuite[]> {
    return [...this.suites.values()]
      .filter((suite) => suite.workspaceId === workspaceId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async saveSuiteVersion(version: EvaluationSuiteVersion): Promise<void> {
    const existing = this.versions.get(version.id);
    if (existing !== undefined && existing !== version) {
      throw new DomainInvariantError(
        `EvaluationSuiteVersion '${version.id}' is immutable and cannot be replaced.`,
      );
    }

    this.versions.set(version.id, version);
    for (const evaluationCase of version.cases) {
      this.cases.set(evaluationCase.id, evaluationCase);
    }
  }

  async findSuiteVersionById(
    id: EvaluationSuiteVersionId,
  ): Promise<EvaluationSuiteVersion | null> {
    const version = this.versions.get(id);
    if (version === undefined) {
      return null;
    }

    const cases = [...this.cases.values()]
      .filter(
        (evaluationCase) => evaluationCase.evaluationSuiteVersionId === id,
      )
      .sort((left, right) => left.key.localeCompare(right.key));

    return EvaluationSuiteVersion.rehydrate({
      id: version.id,
      evaluationSuiteId: version.evaluationSuiteId,
      workspaceId: version.workspaceId,
      version: version.version,
      createdAt: version.createdAt,
      cases,
    });
  }

  async listSuiteVersionsBySuite(
    evaluationSuiteId: EvaluationSuiteId,
  ): Promise<readonly EvaluationSuiteVersion[]> {
    const versions = [...this.versions.values()]
      .filter((version) => version.evaluationSuiteId === evaluationSuiteId)
      .sort((left, right) => left.version - right.version);

    return Promise.all(
      versions.map(async (version) => {
        const hydrated = await this.findSuiteVersionById(version.id);
        return hydrated!;
      }),
    );
  }

  async saveEvaluationRun(evaluationRun: EvaluationRun): Promise<void> {
    this.evaluationRuns.set(evaluationRun.id, evaluationRun);
  }

  async findEvaluationRunById(
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null> {
    return this.evaluationRuns.get(id) ?? null;
  }

  async findEvaluationRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null> {
    const evaluationRun = this.evaluationRuns.get(id);
    if (
      evaluationRun === undefined ||
      evaluationRun.workspaceId !== workspaceId
    ) {
      return null;
    }

    return evaluationRun;
  }

  async transitionEvaluationRun(
    expectedStatus: EvaluationRunState,
    next: EvaluationRun,
  ): Promise<EvaluationRun> {
    const current = this.evaluationRuns.get(next.id);
    if (current === undefined) {
      throw new EvaluationRunNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError(
        "evaluationRun",
        next.id,
        expectedStatus,
      );
    }

    assertLegalEvaluationRunTransition(current.status, next.status);
    this.evaluationRuns.set(next.id, next);
    return next;
  }

  async saveCaseResult(result: EvaluationCaseResult): Promise<void> {
    this.caseResults.set(result.id, result);
  }

  async findCaseResultByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationCaseResult | null> {
    for (const result of this.caseResults.values()) {
      if (
        result.evaluationRunId === evaluationRunId &&
        result.evaluationCaseId === evaluationCaseId
      ) {
        return result;
      }
    }

    return null;
  }

  async listCaseResultsByEvaluationRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly EvaluationCaseResult[]> {
    return [...this.caseResults.values()]
      .filter((result) => result.evaluationRunId === evaluationRunId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async findCaseById(id: EvaluationCaseId): Promise<EvaluationCase | null> {
    return this.cases.get(id) ?? null;
  }
}
