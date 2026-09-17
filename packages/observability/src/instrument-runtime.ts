import type {
  ExecutionRequest,
  ExecutionResult,
  RuntimeAdapter,
} from "@osva/contracts";

import { OSVA_ATTR } from "./attributes.js";
import {
  elapsedMs,
  normalizeErrorCategory,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "./instrumentation.js";
import { OSVA_METRIC } from "./metrics.js";
import { OSVA_SPAN } from "./span-names.js";

export function createInstrumentedRuntimeAdapter(
  runtime: RuntimeAdapter,
  instrumentation: OsvaInstrumentation | undefined,
): RuntimeAdapter {
  const telemetry = resolveInstrumentation(instrumentation);

  return {
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
      const startedAt = performance.now();

      return telemetry.withSpan(
        OSVA_SPAN.RUNTIME_EXECUTE,
        {
          [OSVA_ATTR.RUN_ID]: request.runId,
          [OSVA_ATTR.RUN_ATTEMPT_ID]: request.runAttemptId,
          [OSVA_ATTR.AGENT_VERSION_ID]: request.agentVersionId,
          [OSVA_ATTR.RUNTIME_KIND]: request.runtime.type,
        },
        async (span) => {
          try {
            const result = await runtime.execute(request);
            span.setStatus(result.status === "succeeded");
            if (result.status === "failed") {
              span.setAttributes({
                [OSVA_ATTR.ERROR_CATEGORY]: result.error.code,
              });
            }
            return result;
          } catch (error) {
            span.setStatus(false, normalizeErrorCategory(error));
            span.recordException(error);
            throw error;
          } finally {
            telemetry.recordHistogram(
              OSVA_METRIC.RUN_DURATION_MS,
              elapsedMs(startedAt, performance.now()),
              {
                runtime_kind: request.runtime.type,
              },
            );
          }
        },
      );
    },
    ...(isClosableRuntime(runtime)
      ? {
          close: () => runtime.close(),
        }
      : {}),
  };
}

function isClosableRuntime(
  value: RuntimeAdapter,
): value is RuntimeAdapter & { close(): Promise<void> } {
  return (
    "close" in value &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
