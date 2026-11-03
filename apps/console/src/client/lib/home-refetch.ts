import type { HomePageData } from "../hooks/use-home-page-data";

export function refetchHomeEvidence(data: HomePageData): void {
  void data.agentsQuery.refetch();
  void data.workflowsQuery.refetch();
  void data.recentRunsQuery.refetch();
  void data.recentWorkflowRunsQuery.refetch();
  void data.authContextQuery.refetch();
}
