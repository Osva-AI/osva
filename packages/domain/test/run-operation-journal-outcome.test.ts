import { TOOL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { resolveRunOperationJournalFailureDisposition } from "@osva-ai/contracts";

function toolError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("resolveRunOperationJournalFailureDisposition", () => {
  it("does not mutate the journal before pending is recorded", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "UNKNOWN_WRITE",
        error: toolError(TOOL_ERROR_CODES.CONNECTOR_TIMEOUT),
        pendingRecorded: false,
      }).kind,
    ).toBe("no_journal_update");
  });

  it("marks unknown writes uncertain on ambiguous transport failures", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "UNKNOWN_WRITE",
        error: toolError(TOOL_ERROR_CODES.CONNECTOR_TIMEOUT),
        pendingRecorded: true,
      }).kind,
    ).toBe("uncertain");
  });

  it("never marks unknown writes as definitively failed after dispatch", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "UNKNOWN_WRITE",
        error: toolError(TOOL_ERROR_CODES.INVALID_TOOL_OUTPUT),
        pendingRecorded: true,
      }).kind,
    ).toBe("uncertain");
  });

  it("allows read-only operations to fail definitively on provider-confirmed errors", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "READ_ONLY",
        error: toolError(TOOL_ERROR_CODES.INVALID_TOOL_OUTPUT),
        pendingRecorded: true,
      }).kind,
    ).toBe("definitive_failed");
  });

  it("keeps read-only transport ambiguity uncertain", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "READ_ONLY",
        error: toolError(TOOL_ERROR_CODES.CONNECTOR_TIMEOUT),
        pendingRecorded: true,
      }).kind,
    ).toBe("uncertain");
  });

  it("treats idempotent writes as uncertain without verified provider idempotency", () => {
    expect(
      resolveRunOperationJournalFailureDisposition({
        idempotencyClass: "IDEMPOTENT_WRITE",
        error: toolError(TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR),
        pendingRecorded: true,
      }).kind,
    ).toBe("uncertain");
  });
});
