import type { ReconcileWorkflowRunIds } from "@osva/orchestration";
import type { WorkflowOrchestratorTick } from "@osva/orchestration";
import type { WorkflowWaitDriverTick } from "@osva/orchestration";

export async function runWorkflowOrchestratorPipeline(input: {
  readonly now: Date;
  readonly ids: ReconcileWorkflowRunIds;
  readonly waitDriver: WorkflowWaitDriverTick;
  readonly workflowTick: WorkflowOrchestratorTick;
}): Promise<void> {
  await input.waitDriver.execute(input.now);
  await input.workflowTick.execute(input.now, input.ids);
}
