import type {
  EvaluationComparisonId,
  EvaluationRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { EvaluationComparison } from "@osva/domain";
import type {
  EvaluationComparisonRepository,
  ListEvaluationComparisonsQuery,
  ListEvaluationComparisonsResult,
} from "@osva/domain";

export class MemoryEvaluationComparisonRepository implements EvaluationComparisonRepository {
  private readonly comparisons = new Map<
    EvaluationComparisonId,
    EvaluationComparison
  >();

  async saveComparisonIfAbsent(
    comparison: EvaluationComparison,
  ): Promise<"created" | "existing"> {
    if (this.comparisons.has(comparison.id)) {
      return "existing";
    }
    this.comparisons.set(comparison.id, comparison);
    return "created";
  }

  async saveComparison(comparison: EvaluationComparison): Promise<boolean> {
    this.comparisons.set(comparison.id, comparison);
    return true;
  }

  async findComparisonById(
    id: EvaluationComparisonId,
  ): Promise<EvaluationComparison | null> {
    return this.comparisons.get(id) ?? null;
  }

  async findComparisonByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationComparisonId,
  ): Promise<EvaluationComparison | null> {
    const comparison = this.comparisons.get(id);
    return comparison?.workspaceId === workspaceId ? comparison : null;
  }

  async findByRunPair(
    baselineEvaluationRunId: EvaluationRunId,
    candidateEvaluationRunId: EvaluationRunId,
  ): Promise<EvaluationComparison | null> {
    for (const comparison of this.comparisons.values()) {
      if (
        comparison.baselineEvaluationRunId === baselineEvaluationRunId &&
        comparison.candidateEvaluationRunId === candidateEvaluationRunId
      ) {
        return comparison;
      }
    }
    return null;
  }

  async listComparisonsByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly EvaluationComparison[]> {
    const page = await this.listComparisons({ workspaceId, limit });
    return page.comparisons;
  }

  async listComparisons(
    query: ListEvaluationComparisonsQuery,
  ): Promise<ListEvaluationComparisonsResult> {
    let items = [...this.comparisons.values()].filter(
      (comparison) => comparison.workspaceId === query.workspaceId,
    );
    if (query.status !== undefined) {
      items = items.filter((c) => c.status === query.status);
    }
    if (query.evaluationSuiteVersionId !== undefined) {
      items = items.filter(
        (c) => c.evaluationSuiteVersionId === query.evaluationSuiteVersionId,
      );
    }
    if (query.baselineEvaluationRunId !== undefined) {
      items = items.filter(
        (c) => c.baselineEvaluationRunId === query.baselineEvaluationRunId,
      );
    }
    if (query.candidateEvaluationRunId !== undefined) {
      items = items.filter(
        (c) => c.candidateEvaluationRunId === query.candidateEvaluationRunId,
      );
    }
    items = items.sort((a, b) => {
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    });
    if (query.cursor !== undefined) {
      items = items.filter(
        (c) =>
          c.createdAt.getTime() < query.cursor!.createdAt.getTime() ||
          (c.createdAt.getTime() === query.cursor!.createdAt.getTime() &&
            c.id < query.cursor!.id),
      );
    }
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      comparisons: page,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async listComparisonsPendingReconciliation(
    limit: number,
  ): Promise<readonly EvaluationComparison[]> {
    return [...this.comparisons.values()]
      .filter(
        (comparison) =>
          comparison.status === "RUNNING" &&
          comparison.pairwiseConfig?.enabled === true,
      )
      .slice(0, limit);
  }
}
