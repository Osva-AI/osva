import type { JsonValue } from "@osva/contracts";

import { toolGatewayError } from "../errors.js";
import type { InternalToolImplementation } from "./implementation.js";

export const clockNowImplementation: InternalToolImplementation = {
  invoke(input, context) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw toolGatewayError(
        "INVALID_TOOL_INPUT",
        "Clock tool input must be an object.",
      );
    }

    if (Object.keys(input as Record<string, unknown>).length !== 0) {
      throw toolGatewayError(
        "INVALID_TOOL_INPUT",
        "Clock tool input must be an empty object.",
      );
    }

    return Object.freeze({
      iso: context.clock.now().toISOString(),
    }) as JsonValue;
  },
};
