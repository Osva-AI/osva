import type { ExecutionRequest } from "@osva/contracts";

import { deepFreeze } from "./json.js";
import type { TrustedAgentContext } from "./protocol.js";

export function createTrustedAgentContext(
  request: ExecutionRequest,
): TrustedAgentContext {
  return deepFreeze({
    input: request.input,
    runId: request.runId,
    runAttemptId: request.runAttemptId,
    workspaceId: request.workspaceId,
    agentId: request.agentId,
    agentVersionId: request.agentVersionId,
  });
}
