import { inArray } from "drizzle-orm";

import { workflowRuns } from "../schema/workflow-runs.js";

export const ACTIVE_WORKFLOW_RUN_STATUSES_FOR_WAIT_DISCOVERY = [
  "PENDING",
  "RUNNING",
  "WAITING",
] as const;

export function activeWorkflowRunForWaitDiscovery() {
  return inArray(workflowRuns.status, [
    ...ACTIVE_WORKFLOW_RUN_STATUSES_FOR_WAIT_DISCOVERY,
  ]);
}
