import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  mapModelGatewayErrorToBuilderFailure,
  sanitizeBuilderProviderDiagnostic,
} from "../src/builder/builder-model-gateway-diagnostics.js";

describe("builder model gateway diagnostics", () => {
  it("sanitizes allowlisted provider tokens and drops secrets", () => {
    const diag = sanitizeBuilderProviderDiagnostic({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      message: "ignored",
      provider: "openai",
      providerStatusCode: 400,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "response_format",
      providerRequestId: "req_abc",
      retryable: false,
    });
    expect(diag).toMatchObject({
      modelGatewayErrorCode: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      provider: "OPENAI",
      providerHttpStatus: 400,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "response_format",
      providerRequestId: "req_abc",
      providerHttpResponseObserved: true,
    });
    expect(
      sanitizeBuilderProviderDiagnostic({
        code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
        message: "x",
        providerErrorCode: "Bearer sk-secret",
      }).providerErrorCode,
    ).toBeUndefined();
  });

  it("maps MODEL_INVALID_REQUEST to PROVIDER_ERROR with diagnostics, not raw message", () => {
    const failure = mapModelGatewayErrorToBuilderFailure({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      message: "sensitive provider text",
      provider: "openai",
      providerStatusCode: 400,
      providerErrorCode: "invalid_json_schema",
    });
    expect(failure.errorCode).toBe("PROVIDER_ERROR");
    expect(failure.message).toBe("The model provider rejected the request.");
    expect(failure.message).not.toContain("sensitive");
    expect(failure.providerDiagnostic?.providerHttpStatus).toBe(400);
  });
});
