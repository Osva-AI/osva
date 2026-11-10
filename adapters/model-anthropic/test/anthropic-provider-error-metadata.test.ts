import { describe, expect, it } from "vitest";

import {
  anthropicErrorMetadata,
  isAnthropicClassifiedInvalidRequestCode,
} from "../src/anthropic-provider-error-metadata.js";
import { ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES } from "../src/anthropic-invalid-request-codes.js";

describe("anthropic provider error metadata", () => {
  it("exposes only allowlisted classified invalid_request codes", () => {
    for (const code of ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES) {
      expect(isAnthropicClassifiedInvalidRequestCode(code)).toBe(true);
    }
    expect(isAnthropicClassifiedInvalidRequestCode("random_code")).toBe(false);
  });

  it("classifies workspace selection required", () => {
    const meta = anthropicErrorMetadata({
      status: 400,
      error: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace this request acts in.",
        },
      },
      headers: new Headers({ "request-id": "req_011Cgsq68g8bFB5dvXnao6xR" }),
    });
    expect(meta).toMatchObject({
      providerErrorType: "invalid_request_error",
      providerErrorCode: "workspace_selection_required",
      providerErrorParam: "anthropic-workspace-id",
      providerRequestId: "req_011Cgsq68g8bFB5dvXnao6xR",
    });
    expect(JSON.stringify(meta)).not.toContain("identity-linked");
  });

  it("classifies workspace selection invalid", () => {
    const meta = anthropicErrorMetadata({
      status: 400,
      error: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "anthropic-workspace-id header must be a valid workspace ID.",
        },
      },
    });
    expect(meta.providerErrorCode).toBe("workspace_selection_invalid");
    expect(meta.providerErrorParam).toBe("anthropic-workspace-id");
  });

  it("classifies spend limit, schema, parameter, and malformed errors", () => {
    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "Organization spend limit exceeded for this period.",
          },
        },
      }).providerErrorCode,
    ).toBe("organization_spend_limit");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "Schema is too complex for compilation.",
          },
        },
      }).providerErrorCode,
    ).toBe("schema_too_complex");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message:
              "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
          },
        },
        headers: new Headers({ "request-id": "req_011CgszPfmvYouqurP4teE5H" }),
      }).providerErrorCode,
    ).toBe("compiled_grammar_too_large");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: For 'string' type, property 'pattern' is not supported",
          },
        },
      }).providerErrorCode,
    ).toBe("unsupported_schema_feature");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "Unsupported parameter: top_k",
          },
        },
      }).providerErrorCode,
    ).toBe("unsupported_parameter");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "messages: malformed message at index 0",
          },
        },
      }).providerErrorCode,
    ).toBe("malformed_message");
  });

  it("emits reason fingerprint only when diagnostics env is enabled", () => {
    const prev = process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS;
    process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS = "1";
    try {
      const meta = anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: property 'enum' is not supported",
          },
        },
      });
      expect(meta.providerErrorReasonFingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(meta.providerErrorReasonTokens).toEqual(
        expect.arrayContaining([
          "output_config.format.schema",
          "enum",
          "output_config",
        ]),
      );
      expect(JSON.stringify(meta)).not.toContain("property 'enum'");

      const grammar = anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message:
              "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
          },
        },
      });
      expect(grammar.providerErrorCode).toBe("compiled_grammar_too_large");
      expect(grammar.providerErrorCode).not.toBe("other_invalid_request");
      expect(grammar.providerErrorReasonTokens).toEqual(
        expect.arrayContaining(["compiled_grammar"]),
      );
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS;
      } else {
        process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS = prev;
      }
    }
  });

  it("falls back to other_invalid_request then unrecognized_request", () => {
    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "unknown rejection",
          },
        },
      }).providerErrorCode,
    ).toBe("other_invalid_request");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: { error: { type: "invalid_request_error" } },
      }).providerErrorCode,
    ).toBe("unrecognized_request");

    expect(
      anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message: "Bearer sk-secret leaked",
          },
        },
      }).providerErrorCode,
    ).toBe("other_invalid_request");
  });
});
