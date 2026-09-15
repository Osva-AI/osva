import type {
  JsonValue,
  ToolGateway as ToolGatewayPort,
  ToolInvokeRequest,
  ToolPolicy,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";
import type { ToolRepository } from "@osva/domain";

import { ToolGatewayError, toolGatewayError } from "./errors.js";
import type { Clock } from "./internal/clock.js";
import { systemClock } from "./internal/clock.js";
import { getInternalToolCatalogEntry } from "./internal/catalog.js";
import { resolveInternalToolImplementation } from "./internal/registry.js";

export interface ToolGatewayDependencies {
  readonly tools: ToolRepository;
  readonly policy: ToolPolicy;
  readonly clock?: Clock;
}

/**
 * Provider-neutral Stage 1 ToolGateway.
 *
 * Loads an immutable ToolVersion, authorizes through ToolPolicy, and dispatches
 * to allowlisted internal implementations. It does not own Run lifecycle
 * persistence or idempotency deduplication.
 */
export class ToolGateway implements ToolGatewayPort {
  private readonly clock: Clock;

  constructor(private readonly deps: ToolGatewayDependencies) {
    this.clock = deps.clock ?? systemClock;
  }

  async invoke(request: ToolInvokeRequest): Promise<JsonValue> {
    await Promise.resolve(
      this.deps.policy.authorizeToolInvocation(request.authorization),
    ).catch((error) => {
      if (error instanceof ToolGatewayError) {
        throw error;
      }

      throw toolGatewayError(
        "TOOL_NOT_AUTHORIZED",
        error instanceof Error
          ? error.message
          : "Tool invocation was not authorized.",
      );
    });

    if (!request.toolVersionId) {
      throw toolGatewayError(
        "TOOL_VERSION_NOT_FOUND",
        "ToolVersion was not found.",
      );
    }

    const version = await this.deps.tools.findToolVersionById(
      request.toolVersionId,
    );
    if (version === null) {
      throw toolGatewayError(
        "TOOL_VERSION_NOT_FOUND",
        "ToolVersion was not found.",
      );
    }

    const catalogEntry = getInternalToolCatalogEntry(version.implementation);
    if (catalogEntry === undefined) {
      throw toolGatewayError(
        "TOOL_IMPLEMENTATION_NOT_FOUND",
        "Tool implementation was not found.",
      );
    }

    const implementation = resolveInternalToolImplementation(
      version.implementation,
    );
    if (implementation === undefined) {
      throw toolGatewayError(
        "TOOL_IMPLEMENTATION_NOT_FOUND",
        "Tool implementation was not found.",
      );
    }

    let output: JsonValue;
    try {
      const raw = await implementation.invoke(request.input, {
        clock: this.clock,
      });
      if (!isCanonicalJsonValue(raw)) {
        throw toolGatewayError(
          "INVALID_TOOL_OUTPUT",
          "Tool output is not JSON-compatible.",
        );
      }
      output = raw;
    } catch (error) {
      if (error instanceof ToolGatewayError) {
        throw error;
      }

      throw toolGatewayError(
        "TOOL_EXECUTION_ERROR",
        error instanceof Error ? error.message : "Tool execution failed.",
      );
    }

    return output;
  }
}
