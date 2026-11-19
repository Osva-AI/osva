import type {
  ModelGatewayGenerateTextOptions,
  RoutingProviderAttemptObservation,
} from "@osva/model-gateway";

import { resolveInstrumentation } from "./instrumentation.js";
import { OSVA_METRIC } from "./metrics.js";
import type { RunStepRecorderDependencies } from "./run-step-recorder.js";

export interface RoutingProviderAttemptTelemetryState {
  readonly options: ModelGatewayGenerateTextOptions | undefined;
  readonly providerInvocationCount: number;
}

export function attachRoutingProviderAttemptTelemetry(
  deps: RunStepRecorderDependencies,
  baseOptions: ModelGatewayGenerateTextOptions | undefined,
  providerLabel: string,
): RoutingProviderAttemptTelemetryState {
  const state = { providerInvocations: 0 };
  const routing = baseOptions?.routing;
  if (routing === undefined || routing.policy.enabled !== true) {
    return {
      providerInvocationCount: 0,
      options: baseOptions,
    };
  }

  const onProviderAttempt = (
    observation: RoutingProviderAttemptObservation,
  ) => {
    if (observation.osvaResponseCacheHit) {
      return;
    }
    state.providerInvocations += 1;
    const telemetry = resolveInstrumentation(deps.instrumentation);
    telemetry.recordCounter(OSVA_METRIC.MODEL_CALLS, 1, {
      provider: providerLabel,
    });
  };

  return {
    get providerInvocationCount() {
      return state.providerInvocations;
    },
    options: {
      ...baseOptions,
      routing: {
        ...routing,
        onProviderAttempt,
      },
    },
  };
}

export function shouldRecordFinalProviderMetrics(input: {
  readonly cacheHit: boolean;
  readonly routingEnabled: boolean;
  readonly routingProviderInvocations: number;
}): boolean {
  if (input.cacheHit) {
    return false;
  }
  if (input.routingEnabled && input.routingProviderInvocations > 0) {
    return false;
  }
  return true;
}
