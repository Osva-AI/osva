import type { RunAttemptId, RunId } from "@osva/contracts";

import type { Run } from "../run.js";
import type { RunAttempt } from "../run-attempt.js";
import type { RunStep } from "../run-step.js";

export interface RunRepository {
  saveRun(run: Run): Promise<void>;
  findRunById(id: RunId): Promise<Run | null>;
  saveRunAttempt(attempt: RunAttempt): Promise<void>;
  findRunAttemptById(id: RunAttemptId): Promise<RunAttempt | null>;
  listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]>;
  saveRunStep(step: RunStep): Promise<void>;
}
