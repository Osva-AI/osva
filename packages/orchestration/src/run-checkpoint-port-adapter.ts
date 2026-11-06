import type { RunCheckpointPort } from "@osva-ai/contracts";
import type { RunCheckpointRepository } from "@osva/domain";

export function createRunCheckpointPort(
  repository: RunCheckpointRepository,
): RunCheckpointPort {
  return {
    commit: (command) => repository.commit(command),
  };
}
