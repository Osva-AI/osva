import { describe, expect, it, vi } from "vitest";

import {
  buildDeliveryEventRequest,
  buildWorkflowRunInput,
  deliveryEventIdempotencyKey,
  isUuidRequestId,
  parseApproveArgs,
  parseEmitDeliveryEventArgs,
  parseRunArgs,
  parseStatusArgs,
} from "../scripts/lib/args.js";

describe("canonical operator args: run", () => {
  it("requires package and use case", () => {
    expect(() => parseRunArgs([])).toThrow(/Missing required --package/);
    expect(() => parseRunArgs(["--package", "zod"])).toThrow(
      /Missing required --use-case/,
    );
  });

  it("parses repeated constraints and trims values", () => {
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    const parsed = parseRunArgs([
      "--package",
      " zod ",
      "--use-case",
      " Runtime validation ",
      "--constraint",
      "  Must be suitable for production  ",
      "--constraint",
      "Prefer permissive licensing",
    ]);
    randomUuid.mockRestore();

    expect(parsed.packageName).toBe("zod");
    expect(parsed.useCase).toBe("Runtime validation");
    expect(parsed.constraints).toEqual([
      "Must be suitable for production",
      "Prefer permissive licensing",
    ]);
    expect(isUuidRequestId(parsed.requestId)).toBe(true);
    expect(buildWorkflowRunInput(parsed)).toEqual({
      schemaVersion: "1",
      request: {
        requestId: parsed.requestId,
        packageName: parsed.packageName,
        useCase: parsed.useCase,
        constraints: [...parsed.constraints],
      },
    });
  });
});

describe("canonical operator args: approve", () => {
  it("defaults to approve and accepts comment", () => {
    const parsed = parseApproveArgs([
      "wfr-1",
      "--comment",
      "Proceed with the final report.",
    ]);
    expect(parsed).toEqual({
      workflowRunId: "wfr-1",
      decision: "APPROVED",
      comment: "Proceed with the final report.",
    });
  });

  it("supports rejection", () => {
    const parsed = parseApproveArgs([
      "wfr-1",
      "--reject",
      "--comment",
      "License risk is unresolved.",
    ]);
    expect(parsed.decision).toBe("REJECTED");
  });

  it("rejects conflicting approve/reject flags", () => {
    expect(() => parseApproveArgs(["wfr-1", "--approve", "--reject"])).toThrow(
      /not both/,
    );
  });
});

describe("canonical operator args: delivery event", () => {
  it("requires request id", () => {
    expect(() => parseEmitDeliveryEventArgs([])).toThrow(/Missing request id/);
  });

  it("uses stable idempotency key", () => {
    const requestId = "req-canonical-demo-001";
    expect(deliveryEventIdempotencyKey(requestId)).toBe(
      "canonical-demo:delivery:req-canonical-demo-001",
    );
    expect(buildDeliveryEventRequest(requestId)).toEqual({
      source: "canonical-demo",
      eventType: "report.delivery_requested",
      correlationKey: requestId,
      idempotencyKey: "canonical-demo:delivery:req-canonical-demo-001",
      payload: { requestedBy: "canonical-demo-cli" },
    });
  });

  it("accepts optional workflow run resolution flag", () => {
    expect(parseEmitDeliveryEventArgs(["--workflow-run", "wfr-1"])).toEqual({
      requestId: "",
      workflowRunId: "wfr-1",
    });
  });
});

describe("canonical operator args: status", () => {
  it("accepts positional workflow run id", () => {
    expect(parseStatusArgs(["wfr-abc"])).toEqual({ workflowRunId: "wfr-abc" });
  });
});
