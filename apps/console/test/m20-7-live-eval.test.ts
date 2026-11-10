import { describe, expect, it } from "vitest";

import { builderIssue } from "@osva/domain/builder";

import {
  probeArtifactBuilderErrorCode,
  recordLiveProvenanceFromGenerationHttp,
  sanitizeBuilderGenerationFailure,
  type LiveBuilderGenerationResponseShape,
  type M20_7LiveProvenanceState,
} from "./integration/m20-7-live-eval.js";

describe("m20-7-live-eval provider diagnostics", () => {
  it("preserves sanitized providerDiagnostic into acceptance failure evidence", () => {
    const parsed = {
      ok: false,
      errorCode: "PROVIDER_ERROR",
      message: "The model provider rejected the request.",
      providerDiagnostic: {
        modelGatewayErrorCode: "MODEL_INVALID_REQUEST",
        provider: "OPENAI",
        providerHttpStatus: 400,
        providerErrorType: "invalid_request_error",
        providerErrorCode: "invalid_json_schema",
        providerErrorParam: "response_format",
        providerRequestId: "req_m20_7",
        retryable: false,
        providerHttpResponseObserved: true,
      },
      metadata: {
        attempts: 1,
        structuredOutputMode: "provider_json_schema",
        generationProvider: "OPENAI",
        measuredUsage: { usageMeasured: false, inputUnits: 0, outputUnits: 0 },
      },
    };

    const sanitized = sanitizeBuilderGenerationFailure(422, parsed);
    expect(sanitized.httpStatus).toBe(422);
    expect(sanitized.builderErrorCode).toBe("PROVIDER_ERROR");
    expect(probeArtifactBuilderErrorCode(parsed, sanitized)).toBe(
      "PROVIDER_ERROR",
    );
    expect(sanitized.providerDiagnostic).toMatchObject({
      modelGatewayErrorCode: "MODEL_INVALID_REQUEST",
      providerHttpStatus: 400,
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "response_format",
      providerRequestId: "req_m20_7",
      providerHttpResponseObserved: true,
    });
    expect(sanitized.providerAttempts).toBe(1);
    expect(sanitized.measuredUsage?.usageMeasured).toBe(false);

    const provenance: M20_7LiveProvenanceState = {
      liveModeRequested: true,
      liveModeAuthorized: true,
      actualProviderCallsObserved: 0,
      providerInvocationAttemptsObserved: 0,
      providerIdentityVerified: false,
    };

    const failure = recordLiveProvenanceFromGenerationHttp(provenance, {
      httpStatus: 422,
      parsed,
      provider: "OPENAI",
      modelId: "gpt-4o-mini",
      connectionVersionId: "connv-test",
      endpointBaseUrl: "https://api.openai.com/v1",
      forbiddenOrigins: [],
    });

    expect(failure?.providerDiagnostic?.providerHttpStatus).toBe(400);
    expect(provenance.lastBuilderGenerationFailure?.providerDiagnostic).toEqual(
      failure?.providerDiagnostic,
    );
  });

  it("omits builderErrorCode on successful probe bodies", () => {
    const parsed: LiveBuilderGenerationResponseShape = {
      ok: true,
      metadata: {
        attempts: 1,
        measuredUsage: { usageMeasured: true, inputUnits: 10, outputUnits: 4 },
      },
    };
    const sanitized = sanitizeBuilderGenerationFailure(200, parsed);
    expect(sanitized.builderErrorCode).toBe("UNKNOWN_BUILDER_FAILURE");
    expect(probeArtifactBuilderErrorCode(parsed, sanitized)).toBeUndefined();
  });

  it("preserves sanitized compileIssues and attemptDiagnostics into acceptance failure evidence", () => {
    const parsed: LiveBuilderGenerationResponseShape = {
      ok: false,
      errorCode: "INVALID_COMPILED_PROPOSAL",
      message: "Proposal did not pass workspace catalog and compiler checks.",
      compileIssues: [
        builderIssue({
          code: "INVALID_GRAPH_TOPOLOGY",
          message: "Disallowed cycle between a and b.",
          action: "Repair workflow edges.",
          location: { kind: "workflow_edge", from: "a", to: "b" },
        }),
      ],
      metadata: {
        attempts: 2,
        structuredOutputMode: "provider_json_schema",
        generationProvider: "OPENAI",
        measuredUsage: { usageMeasured: true, inputUnits: 10, outputUnits: 20 },
        attemptDiagnostics: [
          {
            providerAttempt: 1,
            afterRepair: false,
            repairAttempted: false,
            validationStage: "pre_publication_compile",
            errorCode: "INVALID_COMPILED_PROPOSAL",
            compileIssues: [
              {
                code: "INVALID_GRAPH_TOPOLOGY",
                severity: "error",
                edgeFrom: "a",
                edgeTo: "b",
                messagePreview: "Disallowed cycle",
              },
            ],
            modelFinishReason: "stop",
          },
          {
            providerAttempt: 2,
            afterRepair: true,
            repairAttempted: true,
            validationStage: "pre_publication_compile",
            errorCode: "INVALID_COMPILED_PROPOSAL",
            compileIssues: [
              {
                code: "INVALID_GRAPH_TOPOLOGY",
                severity: "error",
                messagePreview: "Still invalid",
              },
            ],
          },
        ],
      },
    };

    const sanitized = sanitizeBuilderGenerationFailure(422, parsed);
    expect(sanitized.compileIssues?.[0]).toMatchObject({
      code: "INVALID_GRAPH_TOPOLOGY",
      edgeFrom: "a",
      edgeTo: "b",
    });
    expect(sanitized.attemptDiagnostics).toHaveLength(2);
    expect(sanitized.attemptDiagnostics?.[1]?.repairAttempted).toBe(true);
    expect(sanitized.attemptDiagnostics?.[1]?.afterRepair).toBe(true);
  });

  it("counts provider invocations when builder rejects after successful provider completions", () => {
    const provenance: M20_7LiveProvenanceState = {
      liveModeRequested: true,
      liveModeAuthorized: true,
      actualProviderCallsObserved: 0,
      providerInvocationAttemptsObserved: 0,
      providerIdentityVerified: false,
    };

    recordLiveProvenanceFromGenerationHttp(provenance, {
      httpStatus: 422,
      parsed: {
        ok: false,
        errorCode: "INVALID_COMPILED_PROPOSAL",
        message: "compiler fail",
        metadata: {
          attempts: 2,
          measuredUsage: { usageMeasured: true, inputUnits: 1, outputUnits: 2 },
        },
      },
      provider: "OPENAI",
      modelId: "gpt-4o-mini",
      connectionVersionId: "connv-test",
      endpointBaseUrl: "https://api.openai.com/v1",
      forbiddenOrigins: [],
    });

    expect(provenance.actualProviderCallsObserved).toBe(2);
    expect(provenance.providerInvocationAttemptsObserved).toBe(2);
    expect(provenance.providerIdentityVerified).toBe(true);
    expect(provenance.verificationCode).toBe(
      "BUILDER_VALIDATION_FAILED_AFTER_PROVIDER",
    );
  });
});
