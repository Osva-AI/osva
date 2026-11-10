import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertAnthropicProbeArtifactSanitized,
  buildAnthropicGenerationProbeArtifact,
  classifyAnthropicGenerationProbeOutcome,
  anthropicGenerationProbeExecuteExitCode,
  providerAdapterAcceptedResponse,
} from "./integration/m20-7-anthropic-generation-probe-eval.js";
import {
  liveExecuteBlockedReason,
  m20_7NonBillableLiveExecuteEnv,
} from "./integration/m20-7-live-guards.js";
import { M20_7_DEFAULT_ANTHROPIC_MODEL } from "./integration/m20-7-anthropic-model-lifecycle.js";

describe("M20.7.4 Anthropic generation probe", () => {
  it.each([
    ["BUILDER_GENERATION_PASS", 0],
    ["PROBE_DRY_RUN", 0],
    ["PROBE_BLOCKED", 0],
    ["PROVIDER_HTTP_ERROR", 1],
    ["TRANSPORT_ERROR", 1],
    ["ADAPTER_ERROR", 1],
    ["BUILDER_VALIDATION_ERROR", 1],
  ])("execute exit code for %s is %i", (outcome, code) => {
    expect(
      anthropicGenerationProbeExecuteExitCode(
        outcome as Parameters<
          typeof anthropicGenerationProbeExecuteExitCode
        >[0],
      ),
    ).toBe(code);
  });

  it("fails closed without billable gates", () => {
    expect(
      liveExecuteBlockedReason(
        m20_7NonBillableLiveExecuteEnv({
          OSVA_M20_7_LIVE_PROVIDER: "anthropic",
          ANTHROPIC_API_KEY: "probe-key",
        }),
        { provider: "anthropic" },
      ),
    ).toBe("OSVA_M20_7_LIVE_EXECUTE not set");
    expect(
      liveExecuteBlockedReason(
        m20_7NonBillableLiveExecuteEnv({
          OSVA_M20_7_LIVE_PROVIDER: "anthropic",
          ANTHROPIC_API_KEY: "probe-key",
          OSVA_M20_7_LIVE_EXECUTE: "1",
        }),
        { provider: "anthropic" },
      ),
    ).toBe("OSVA_M20_7_ALLOW_BILLABLE not set");
  });

  it("classifies provider HTTP vs transport outcomes", () => {
    expect(
      classifyAnthropicGenerationProbeOutcome({
        httpStatus: 422,
        providerAttempts: 1,
        parsed: {
          ok: false,
          errorCode: "PROVIDER_ERROR",
          providerDiagnostic: {
            modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
            providerHttpResponseObserved: true,
            providerHttpStatus: 400,
            providerErrorType: "INVALID_ARGUMENT",
          },
        },
        failure: {
          httpStatus: 422,
          builderErrorCode: "PROVIDER_ERROR",
          builderMessage: "rejected",
          providerAttempts: 1,
          providerDiagnostic: {
            modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
            providerHttpResponseObserved: true,
            providerHttpStatus: 400,
            providerErrorType: "INVALID_ARGUMENT",
          },
        },
      }),
    ).toBe("PROVIDER_HTTP_ERROR");

    expect(
      classifyAnthropicGenerationProbeOutcome({
        httpStatus: 422,
        providerAttempts: 1,
        parsed: {
          ok: false,
          errorCode: "PROVIDER_ERROR",
          providerDiagnostic: {
            modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
            providerHttpResponseObserved: false,
            providerTransportErrorCategory: "connection_failed",
          },
        },
        failure: {
          httpStatus: 422,
          builderErrorCode: "PROVIDER_ERROR",
          builderMessage: "transport",
          providerAttempts: 1,
          providerDiagnostic: {
            modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
            providerHttpResponseObserved: false,
            providerTransportErrorCategory: "connection_failed",
          },
        },
      }),
    ).toBe("TRANSPORT_ERROR");
  });

  it("omits builderErrorCode on successful generation", () => {
    const artifact = buildAnthropicGenerationProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      httpStatus: 200,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: true,
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 3344,
            outputUnits: 941,
          },
        },
      },
    });
    expect(artifact.outcome).toBe("BUILDER_GENERATION_PASS");
    expect(artifact.builderErrorCode).toBeUndefined();
    expect(JSON.stringify(artifact)).not.toContain("UNKNOWN_BUILDER_FAILURE");
    expect(JSON.stringify(artifact)).not.toContain("builderErrorCode");
  });

  it("distinguishes builder pass from provider-only acceptance", () => {
    expect(
      classifyAnthropicGenerationProbeOutcome({
        httpStatus: 200,
        providerAttempts: 1,
        parsed: { ok: true },
      }),
    ).toBe("BUILDER_GENERATION_PASS");

    expect(
      providerAdapterAcceptedResponse({
        providerAttempts: 1,
        parsed: {
          ok: false,
          errorCode: "INVALID_JSON_OUTPUT",
          metadata: {
            attempts: 1,
            attemptDiagnostics: [
              {
                providerAttempt: 1,
                afterRepair: false,
                repairAttempted: false,
                validationStage: "json_output",
                errorCode: "INVALID_JSON_OUTPUT",
              },
            ],
          },
        },
      }),
    ).toBe(true);

    expect(
      classifyAnthropicGenerationProbeOutcome({
        httpStatus: 422,
        providerAttempts: 1,
        parsed: {
          ok: false,
          errorCode: "INVALID_JSON_OUTPUT",
          metadata: {
            attempts: 1,
            attemptDiagnostics: [
              {
                providerAttempt: 1,
                afterRepair: false,
                repairAttempted: false,
                validationStage: "json_output",
                errorCode: "INVALID_JSON_OUTPUT",
              },
            ],
          },
        },
        failure: {
          httpStatus: 422,
          builderErrorCode: "INVALID_JSON_OUTPUT",
          builderMessage: "bad json",
          providerAttempts: 1,
        },
      }),
    ).toBe("BUILDER_VALIDATION_ERROR");
  });

  it("builds sanitized dry-run artifact without secrets", () => {
    const artifact = buildAnthropicGenerationProbeArtifact({
      mode: "dry_run",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      maxProviderInvocations: 1,
      maxEstimatedCostUsdMicros: 250_000,
      invocationAttempted: false,
    });
    expect(artifact.outcome).toBe("PROBE_DRY_RUN");
    expect(artifact.structuredOutputWire).toBe("outputConfigJsonSchema");
    expect(
      buildAnthropicGenerationProbeArtifact({
        mode: "dry_run",
        modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
        maxProviderInvocations: 1,
        maxEstimatedCostUsdMicros: 250_000,
        maxInputTokensPerAttempt: 8192,
        maxOutputTokensPerAttempt: 2048,
        estimatedWorstCaseMicroUsd: 36864,
        invocationAttempted: false,
      }).budgets.estimatedWorstCaseMicroUsd,
    ).toBe(36864);
    assertAnthropicProbeArtifactSanitized(
      artifact as unknown as Record<string, unknown>,
    );
  });

  it("dry-run artifact omits forbidden payload fields", () => {
    const artifact = buildAnthropicGenerationProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      httpStatus: 422,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: false,
        errorCode: "PROVIDER_ERROR",
        providerDiagnostic: {
          modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
          providerHttpResponseObserved: false,
          providerTransportErrorCategory: "connection_failed",
        },
      },
    });
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("userInstruction");
    expect(artifact.outcome).toBe("TRANSPORT_ERROR");
  });
});
