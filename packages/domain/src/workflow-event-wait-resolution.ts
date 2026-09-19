import { DomainInvariantError } from "./errors.js";
import { decideWorkflowEventWait } from "./workflow-wait-event.js";
import type { WorkflowEvent } from "./workflow-event.js";
import type { WorkflowWait } from "./workflow-wait.js";

export type WorkflowEventWaitResolutionOutcome =
  | { readonly status: "unchanged"; readonly wait: WorkflowWait }
  | { readonly status: "resolved"; readonly wait: WorkflowWait };

export function resolveWorkflowEventWaitDecision(
  wait: WorkflowWait,
  candidates: readonly WorkflowEvent[],
  now: Date,
): WorkflowEventWaitResolutionOutcome {
  if (!wait.isActive()) {
    return { status: "unchanged", wait };
  }

  if (wait.kind !== "EVENT") {
    throw new DomainInvariantError(
      "Workflow event wait resolution applies only to EVENT WorkflowWait instances.",
    );
  }

  const decision = decideWorkflowEventWait(wait, candidates, now);
  if (decision.kind === "PENDING") {
    return { status: "unchanged", wait };
  }

  if (decision.kind === "EVENT") {
    return {
      status: "resolved",
      wait: wait.resolveEvent(decision.event, now),
    };
  }

  return {
    status: "resolved",
    wait: wait.resolveTimeout(now),
  };
}
