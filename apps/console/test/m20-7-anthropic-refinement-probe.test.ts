import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertAnthropicRefinementProbeArtifactSanitized,
  buildAnthropicRefinementProbeArtifact,
  classifyAnthropicRefinementProbeOutcome,
  anthropicRefinementProbeExecuteExitCode,
} from "./integration/m20-7-anthropic-refinement-eval.js";
import {
  liveExecuteBlockedReason,
  m20_7NonBillableLiveExecuteEnv,
} from "./integration/m20-7-live-guards.js";
import { M20_7_DEFAULT_ANTHROPIC_MODEL } from "./integration/m20-7-anthropic-model-lifecycle.js";

describe("M20.7.4 Anthropic refinement probe", () => {
  it.each([
    ["BUILDER_REFINEMENT_PASS", 0],
    ["PROBE_DRY_RUN", 0],
    ["PROBE_BLOCKED", 0],
    ["BUILDER_REFINEMENT_FAIL", 1],
    ["PROVIDER_HTTP_ERROR", 1],
    ["TRANSPORT_ERROR", 1],
    ["ADAPTER_ERROR", 1],
    ["BUILDER_VALIDATION_ERROR", 1],
  ])("execute exit code for %s is %i", (outcome, code) => {
    expect(
      anthropicRefinementProbeExecuteExitCode(
        outcome as Parameters<
          typeof anthropicRefinementProbeExecuteExitCode
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
      classifyAnthropicRefinementProbeOutcome({
        httpStatus: 422,
        providerAttempts: 1,
        repairAttempted: false,
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
      classifyAnthropicRefinementProbeOutcome({
        httpStatus: 422,
        providerAttempts: 1,
        repairAttempted: false,
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

  it("builds sanitized dry-run artifact without secrets or proposal bodies", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "dry_run",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      maxProviderInvocations: 1,
      maxEstimatedCostUsdMicros: 250_000,
      maxInputTokensPerAttempt: 8192,
      maxOutputTokensPerAttempt: 2048,
      estimatedWorstCaseMicroUsd: 36864,
      invocationAttempted: false,
    });
    expect(artifact.outcome).toBe("PROBE_DRY_RUN");
    expect(artifact.recordsEncoding).toBe("anthropic_records_v1");
    expect(artifact.isolatedBaseline).toBe("canonical_fixture");
    expect(artifact.provenance.liveGenerationRerun).toBe(false);
    expect(artifact.provenance.workingTreeDirty).toBe(true);
    expect(artifact.budgets.estimatedWorstCaseMicroUsd).toBe(36864);
    assertAnthropicRefinementProbeArtifactSanitized(
      artifact as unknown as Record<string, unknown>,
    );
  });

  it("dry-run artifact omits forbidden payload fields", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 200,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: { ok: true, metadata: { attempts: 1 } },
      canonicalOk: true,
      rubric: {
        score: 2,
        reasons: [],
        requiresHumanReview: false,
        compileOk: true,
      },
    });
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("userInstruction");
    expect(serialized).not.toContain("currentProposal");
    expect(artifact.outcome).toBe("BUILDER_REFINEMENT_PASS");
    expect(artifact.builderErrorCode).toBeUndefined();
    expect(serialized).not.toContain("UNKNOWN_BUILDER_FAILURE");
    expect(serialized).not.toContain("builderErrorCode");
  });

  it("omits builderErrorCode on successful refinement", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 200,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: true,
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 3957,
            outputUnits: 613,
          },
        },
      },
      canonicalOk: true,
      rubric: {
        score: 2,
        reasons: [],
        requiresHumanReview: false,
        compileOk: true,
      },
    });
    expect(artifact.outcome).toBe("BUILDER_REFINEMENT_PASS");
    expect(artifact.builderHttpOk).toBe(true);
    expect(artifact.canonicalValidationOk).toBe(true);
    expect(artifact.compilerValidationOk).toBe(true);
    expect(artifact.builderErrorCode).toBeUndefined();
    expect(JSON.stringify(artifact)).not.toContain("UNKNOWN_BUILDER_FAILURE");
  });

  it("records PROVIDER_ERROR on provider HTTP failure", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 422,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: false,
        errorCode: "PROVIDER_ERROR",
        providerDiagnostic: {
          modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
          providerHttpResponseObserved: true,
          providerHttpStatus: 400,
          providerErrorType: "INVALID_ARGUMENT",
        },
        metadata: { attempts: 1 },
      },
    });
    expect(artifact.outcome).toBe("PROVIDER_HTTP_ERROR");
    expect(artifact.builderErrorCode).toBe("PROVIDER_ERROR");
    expect(artifact.builderRefinementPass).toBe(false);
  });

  it("records INVALID_BUILDER_PROPOSAL on records decoder failure", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 422,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: false,
        errorCode: "INVALID_BUILDER_PROPOSAL",
        message: "Provider output failed records-to-canonical transformation.",
        detailMessages: ["records[0]: unknown record kind 'mystery'."],
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 10,
            outputUnits: 4,
          },
          attemptDiagnostics: [
            {
              providerAttempt: 1,
              afterRepair: false,
              repairAttempted: false,
              validationStage: "proposal_parse",
              errorCode: "INVALID_BUILDER_PROPOSAL",
            },
          ],
        },
      },
      canonicalOk: false,
    });
    expect(artifact.outcome).toBe("BUILDER_VALIDATION_ERROR");
    expect(artifact.builderErrorCode).toBe("INVALID_BUILDER_PROPOSAL");
    expect(artifact.canonicalValidationOk).toBe(false);
    expect(artifact.providerResponseAccepted).toBe(true);
  });

  it("records INVALID_BUILDER_PROPOSAL on canonical validation failure", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 422,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: false,
        errorCode: "INVALID_BUILDER_PROPOSAL",
        message: "Proposal failed structural validation.",
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 10,
            outputUnits: 4,
          },
          attemptDiagnostics: [
            {
              providerAttempt: 1,
              afterRepair: false,
              repairAttempted: false,
              validationStage: "proposal_parse",
              errorCode: "INVALID_BUILDER_PROPOSAL",
            },
          ],
        },
      },
      canonicalOk: false,
    });
    expect(artifact.outcome).toBe("BUILDER_VALIDATION_ERROR");
    expect(artifact.builderErrorCode).toBe("INVALID_BUILDER_PROPOSAL");
    expect(artifact.canonicalValidationOk).toBe(false);
  });

  it("records INVALID_COMPILED_PROPOSAL on compiler failure", () => {
    const artifact = buildAnthropicRefinementProbeArtifact({
      mode: "execute",
      modelId: M20_7_DEFAULT_ANTHROPIC_MODEL,
      workingTreeDirty: true,
      generationArtifactRetained: true,
      httpStatus: 422,
      maxProviderInvocations: 1,
      invocationAttempted: true,
      parsed: {
        ok: false,
        errorCode: "INVALID_COMPILED_PROPOSAL",
        compileIssues: [
          {
            code: "INVALID_GRAPH_TOPOLOGY",
            severity: "error",
            message: "Missing edge target.",
            action: "Repair workflow edges.",
          },
        ],
        metadata: {
          attempts: 1,
          measuredUsage: {
            usageMeasured: true,
            inputUnits: 10,
            outputUnits: 4,
          },
          attemptDiagnostics: [
            {
              providerAttempt: 1,
              afterRepair: false,
              repairAttempted: false,
              validationStage: "pre_publication_compile",
              errorCode: "INVALID_COMPILED_PROPOSAL",
            },
          ],
        },
      },
      canonicalOk: true,
      rubric: {
        score: 0,
        reasons: ["compile_blocking"],
        requiresHumanReview: true,
        compileOk: false,
      },
    });
    expect(artifact.outcome).toBe("BUILDER_VALIDATION_ERROR");
    expect(artifact.builderErrorCode).toBe("INVALID_COMPILED_PROPOSAL");
    expect(artifact.compilerValidationOk).toBe(false);
    expect(artifact.canonicalValidationOk).toBe(true);
  });
});
