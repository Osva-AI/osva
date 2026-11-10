import { describe, expect, it } from "vitest";

import {
  assessAnthropicParsedErrorForLocalDisplay,
  assessAnthropicProviderErrorMessageForLocalDisplay,
  formatAnthropicProviderErrorLocalInspection,
  isAnthropicProviderErrorTextDisplayEnabled,
} from "../src/anthropic-provider-error-local-display.js";

describe("anthropic provider error local display", () => {
  it("allows a classified validation message after safety checks", () => {
    const display = assessAnthropicProviderErrorMessageForLocalDisplay({
      errorType: "invalid_request_error",
      errorMessage:
        "output_config.format.schema: For 'string' type, property 'enum' is not supported",
      requestId: "req_operator_local_ok",
    });
    expect(display.ok).toBe(true);
    if (display.ok) {
      const text = formatAnthropicProviderErrorLocalInspection({
        httpStatus: 400,
        display,
      });
      expect(text).toContain("invalid_request_error");
      expect(text).toContain("req_operator_local_ok");
      expect(text).toContain("property 'enum' is not supported");
    }
  });

  it("refuses credential-like provider text", () => {
    const display = assessAnthropicProviderErrorMessageForLocalDisplay({
      errorType: "invalid_request_error",
      errorMessage: "invalid x-api-key: sk-ant-api03-EXAMPLESECRETVALUE",
      requestId: "req_operator_local_secret",
    });
    expect(display).toEqual({
      ok: false,
      reason:
        "provider error.message contains credential-like material; local display refused",
    });
  });

  it("reads nested Anthropic error JSON", () => {
    const display = assessAnthropicParsedErrorForLocalDisplay({
      parsed: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "output_config.format.schema: schema is too complex",
        },
      },
      requestId: "req_nested",
    });
    expect(display.ok).toBe(true);
    if (display.ok) {
      expect(display.errorType).toBe("invalid_request_error");
      expect(display.errorMessage).toContain("too complex");
    }
  });

  it("opt-in is fail-closed unless env is 1", () => {
    expect(isAnthropicProviderErrorTextDisplayEnabled({})).toBe(false);
    expect(
      isAnthropicProviderErrorTextDisplayEnabled({
        OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT: "1",
      }),
    ).toBe(true);
  });
});
