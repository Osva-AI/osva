import type { JsonValue } from "@osva/contracts";

import type { Clock } from "./clock.js";

export interface InternalToolExecutionContext {
  readonly clock: Clock;
}

export interface InternalToolImplementation {
  invoke(
    input: unknown,
    context: InternalToolExecutionContext,
  ): JsonValue | Promise<JsonValue>;
}
