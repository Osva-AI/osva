import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertGeminiProbeArtifactSanitized,
  buildGeminiGenerationProbeArtifact,
  classifyGeminiGenerationProbeOutcome,
  geminiGenerationProbeExecuteExitCode,
  providerAdapterAcceptedResponse,
} from "./integration/m20-7-gemini-generation-probe-eval.js";
import {
  liveExecuteBlockedReason,
  m20_7NonBillableLiveExecuteEnv,
} from "./integration/m20-7-live-guards.js";
import { M20_7_DEFAULT_GEMINI_MODEL } from "./integration/m20-7-gemini-model-lifecycle.js";

describe("M20.7.3 Gemini generation probe", () => {
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
      geminiGenerationProbeExecuteExitCode(
        outcome as Parameters<typeof geminiGenerationProbeExecuteExitCode>[0],
      ),
    ).toBe(code);
  });

  it("fails closed without billable gates", () => {
    expect(
      liveExecuteBlockedReason(
        m20_7NonBillableLiveExecuteEnv({
          OSVA_M20_7_LIVE_PROVIDER: "gemini",
          GOOGLE_GEMINI_API_KEY: "probe-key",
        }),
        { provider: "gemini" },
      ),
    ).toBe("OSVA_M20_7_LIVE_EXECUTE not set");
    expect(
      liveExecuteBlockedReason(
        m20_7NonBillableLiveExecuteEnv({
          OSVA_M20_7_LIVE_PROVIDER: "gemini",
          GOOGLE_GEMINI_API_KEY: "probe-key",
          OSVA_M20_7_LIVE_EXECUTE: "1",
        }),
        { provider: "gemini" },
      ),
    ).toBe("OSVA_M20_7_ALLOW_BILLABLE not set");
  });

  it("classifies provider HTTP vs transport outcomes", () => {
    expect(
      classifyGeminiGenerationProbeOutcome({
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
      classifyGeminiGenerationProbeOutcome({
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
    const artifact = buildGeminiGenerationProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_GEMINI_MODEL,
      httpStatus: 200,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: true,
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 100,
            outputUnits: 50,
          },
        },
      },
    });
    expect(artifact.outcome).toBe("BUILDER_GENERATION_PASS");
    expect(artifact.builderErrorCode).toBeUndefined();
    expect(JSON.stringify(artifact)).not.toContain("UNKNOWN_BUILDER_FAILURE");
  });

  it("distinguishes builder pass from provider-only acceptance", () => {
    expect(
      classifyGeminiGenerationProbeOutcome({
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
      classifyGeminiGenerationProbeOutcome({
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
    const artifact = buildGeminiGenerationProbeArtifact({
      mode: "dry_run",
      modelId: M20_7_DEFAULT_GEMINI_MODEL,
      maxProviderInvocations: 1,
      maxEstimatedCostUsdMicros: 250_000,
      invocationAttempted: false,
    });
    expect(artifact.outcome).toBe("PROBE_DRY_RUN");
    expect(artifact.structuredOutputWire).toBe("responseJsonSchema");
    expect(
      buildGeminiGenerationProbeArtifact({
        mode: "dry_run",
        modelId: M20_7_DEFAULT_GEMINI_MODEL,
        maxProviderInvocations: 1,
        maxEstimatedCostUsdMicros: 250_000,
        maxInputTokensPerAttempt: 8192,
        maxOutputTokensPerAttempt: 2048,
        estimatedWorstCaseMicroUsd: 13824,
        invocationAttempted: false,
      }).budgets.estimatedWorstCaseMicroUsd,
    ).toBe(13824);
    assertGeminiProbeArtifactSanitized(
      artifact as unknown as Record<string, unknown>,
    );
  });

  it("dry-run artifact omits forbidden payload fields", () => {
    const artifact = buildGeminiGenerationProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_GEMINI_MODEL,
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
