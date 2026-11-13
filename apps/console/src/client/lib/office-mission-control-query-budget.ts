/**
 * Estimates distinct HTTP reads for a cold Mission Control load with recent
 * activity/deliverable sections (M22.5C). TanStack Query dedupes identical keys
 * across the page and {@link MissionControlRecentSections}; this counts unique
 * query families, not duplicate hook instances.
 */
export interface OfficeMissionControlQueryBudgetInput {
  readonly teamCount: number;
  readonly distinctLaunchedWorkflowRunCount: number;
  readonly includeMissionControlRecentSections: boolean;
}

export interface OfficeMissionControlQueryBudgetEstimate {
  readonly assignments: number;
  readonly workers: number;
  readonly teams: number;
  readonly goals: number;
  readonly agentsList: number;
  readonly teamMembershipLists: number;
  readonly agentVersionCatalog: number;
  readonly artifactListPages: number;
  readonly workflowRunGets: number;
  readonly workflowVersionGets: number;
  readonly totalDistinctGets: number;
}

export function estimateOfficeMissionControlHttpReads(
  input: OfficeMissionControlQueryBudgetInput,
): OfficeMissionControlQueryBudgetEstimate {
  const teams = Math.max(0, input.teamCount);
  const workflowRuns = Math.max(0, input.distinctLaunchedWorkflowRunCount);

  const assignments = 1;
  const workers = 1;
  const teamsList = 1;
  const agentsList = 1;
  const teamMembershipLists = teams;

  let goals = 0;
  let agentVersionCatalog = 0;
  let artifactListPages = 0;
  let workflowRunGets = 0;
  let workflowVersionGets = 0;

  if (input.includeMissionControlRecentSections) {
    goals = 1;
    agentVersionCatalog = 1;
    artifactListPages = 1;
    workflowRunGets = workflowRuns;
    workflowVersionGets = workflowRuns;
  }

  const totalDistinctGets =
    assignments +
    workers +
    teamsList +
    agentsList +
    teamMembershipLists +
    goals +
    agentVersionCatalog +
    artifactListPages +
    workflowRunGets +
    workflowVersionGets;

  return {
    assignments,
    workers,
    teams: teamsList,
    goals,
    agentsList,
    teamMembershipLists,
    agentVersionCatalog,
    artifactListPages,
    workflowRunGets,
    workflowVersionGets,
    totalDistinctGets,
  };
}
