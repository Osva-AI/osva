import { describe, expect, it } from "vitest";

import {
  ContainerProtocolParseError,
  formatRuntimeExecuteRequestPayload,
  parseContainerProtocolStdout,
} from "../src/protocol-io.js";
import { CONTAINER_PROTOCOL_STDOUT_MAX_BYTES } from "../src/output-limits.js";

describe("protocol-io", () => {
  it("formats RuntimeExecuteRequest as a single newline-delimited JSON payload", () => {
    const payload = formatRuntimeExecuteRequestPayload({
      protocolVersion: "1",
      executionId: "run-attempt-1",
      input: { ok: true },
      capabilities: {
        endpoint: "http://127.0.0.1:8080",
        token: "token",
      },
    });
    expect(payload.endsWith("\n")).toBe(true);
    expect(JSON.parse(payload.trim())).toEqual({
      protocolVersion: "1",
      executionId: "run-attempt-1",
      input: { ok: true },
      capabilities: {
        endpoint: "http://127.0.0.1:8080",
        token: "token",
      },
    });
  });

  it("parses exactly one valid RuntimeExecuteResponse from stdout", () => {
    const stdout = `${JSON.stringify({
      protocolVersion: "1",
      executionId: "run-attempt-1",
      outcome: "SUCCEEDED",
      output: { ok: true },
    })}\n`;

    expect(
      parseContainerProtocolStdout(stdout, "run-attempt-1", {
        stdoutByteLength: Buffer.byteLength(stdout, "utf8"),
        stdoutTruncated: false,
      }).response.outcome,
    ).toBe("SUCCEEDED");
  });

  it("rejects extra stdout content and truncated protocol output", () => {
    const stdout = `${JSON.stringify({
      protocolVersion: "1",
      executionId: "run-attempt-1",
      outcome: "SUCCEEDED",
      output: {},
    })}\nextra\n`;

    expect(() =>
      parseContainerProtocolStdout(stdout, "run-attempt-1", {
        stdoutByteLength: Buffer.byteLength(stdout, "utf8"),
        stdoutTruncated: false,
      }),
    ).toThrowError(ContainerProtocolParseError);

    expect(() =>
      parseContainerProtocolStdout("", "run-attempt-1", {
        stdoutByteLength: CONTAINER_PROTOCOL_STDOUT_MAX_BYTES + 1,
        stdoutTruncated: true,
      }),
    ).toThrowError(ContainerProtocolParseError);
  });
});
