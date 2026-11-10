import { describe, expect, it } from "vitest";

import { anthropicErrorMetadata } from "../src/anthropic-provider-error-metadata.js";
import {
  bucketAnthropicOperatorRejectionCategory,
  formatAnthropicOperatorHttpDiagnostic,
} from "../src/anthropic-operator-http-diagnostic.js";

describe("anthropic operator HTTP diagnostic", () => {
  it("buckets schema vs workspace vs unclassified", () => {
    expect(
      bucketAnthropicOperatorRejectionCategory("compiled_grammar_too_large"),
    ).toBe("schema_output");
    expect(
      bucketAnthropicOperatorRejectionCategory("unsupported_schema_feature"),
    ).toBe("schema_output");
    expect(
      bucketAnthropicOperatorRejectionCategory("workspace_selection_required"),
    ).toBe("workspace_selection");
    expect(
      bucketAnthropicOperatorRejectionCategory("other_invalid_request"),
    ).toBe("unclassified_invalid_request");
  });

  it("serializes structured operator line without raw provider text", () => {
    const prev = process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS;
    process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS = "1";
    try {
      const meta = anthropicErrorMetadata({
        status: 400,
        error: {
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: invalid schema — property 'pattern' is forbidden secret text",
          },
        },
        headers: new Headers({ "request-id": "req_operator_test" }),
      });
      const line = formatAnthropicOperatorHttpDiagnostic(meta);
      expect(line).toContain("anthropic_operator_http_diagnostic");
      expect(line).toContain("unsupported_schema_feature");
      expect(line).not.toContain("forbidden secret");
      expect(line).not.toContain("pattern' is forbidden");
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS;
      } else {
        process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS = prev;
      }
    }
  });
});
