import type { InternalToolImplementationId } from "@osva/contracts";

import { clockNowImplementation } from "./clock-now.js";
import { echoImplementation } from "./echo.js";
import type { InternalToolImplementation } from "./implementation.js";

const IMPLEMENTATIONS: Readonly<
  Record<InternalToolImplementationId, InternalToolImplementation>
> = Object.freeze({
  OSVA_ECHO_V1: echoImplementation,
  OSVA_CLOCK_NOW_V1: clockNowImplementation,
});

export function resolveInternalToolImplementation(
  implementation: InternalToolImplementationId,
): InternalToolImplementation | undefined {
  return IMPLEMENTATIONS[implementation];
}
