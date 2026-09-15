import type { JsonValue } from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { toolGatewayError } from "../errors.js";
import type { InternalToolImplementation } from "./implementation.js";

export const echoImplementation: InternalToolImplementation = {
  invoke(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw toolGatewayError(
        "INVALID_TOOL_INPUT",
        "Echo tool input must be an object with a value field.",
      );
    }

    const record = input as Record<string, unknown>;
    if (!("value" in record)) {
      throw toolGatewayError(
        "INVALID_TOOL_INPUT",
        "Echo tool input must include a value field.",
      );
    }

    if (!isCanonicalJsonValue(record.value)) {
      throw toolGatewayError(
        "INVALID_TOOL_INPUT",
        "Echo tool value must be JSON-compatible.",
      );
    }

    return Object.freeze({
      value: record.value,
    }) as JsonValue;
  },
};
