import { describe, expect, it } from "vitest";

import {
  assertBatchInferenceJobStatusTransition,
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
  BATCH_INFERENCE_MAX_ITEM_COUNT,
  BATCH_INFERENCE_PROVIDER_CAPABILITIES,
  canTransitionBatchInferenceJobStatus,
  createDefaultBatchInferenceEligibilityPolicy,
  isBatchInferenceTerminalJobStatus,
  partitionBatchInferenceProviderCorrelations,
  reconcileBatchInferenceItemOutcomes,
  validateUniqueBatchInferenceItemIds,
} from "../src/index.js";
import { batchInferenceCreateJobRequestSchema } from "../src/schemas/batch-inference.js";
import type { BatchInferenceItemId } from "../src/ids.js";
import type { BatchInferenceItemOutcome } from "../src/batch-inference.js";

const workspaceId = "ws_test" as const;
const jobId = "batch_job_1" as const;
const modelProfileVersionId = "mpv_1" as const;
const providerConnectionVersionId = "mpcv_1" as const;

function itemId(s: string): BatchInferenceItemId {
  return s as BatchInferenceItemId;
}

function minimalCreateRequest(
  overrides: Partial<{
    items: Array<{
      itemId: BatchInferenceItemId;
      providerCorrelationId: string;
    }>;
  }> = {},
) {
  const items = overrides.items ?? [
    {
      itemId: itemId("item_a"),
      providerCorrelationId: "corr_a",
    },
    {
      itemId: itemId("item_b"),
      providerCorrelationId: "corr_b",
    },
  ];

  return {
    formatVersion: BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
    workspaceId,
    jobId,
    modelProfileVersionId,
    providerConnectionVersionId,
    submissionFingerprint: "fingerprint_stable_16ch",
    executionMode: "PROVIDER_NATIVE_ASYNC" as const,
    items: items.map((row) => ({
      itemId: row.itemId,
      providerCorrelationId: row.providerCorrelationId,
      input: {
        messages: [{ role: "user" as const, content: "hello" }],
      },
    })),
  };
}

describe("batch inference create schema", () => {
  it("accepts a valid creation request", () => {
    const parsed = batchInferenceCreateJobRequestSchema.parse(
      minimalCreateRequest(),
    );
    expect(parsed.items).toHaveLength(2);
  });

  it("rejects duplicate item ids", () => {
    const result = batchInferenceCreateJobRequestSchema.safeParse(
      minimalCreateRequest({
        items: [
          { itemId: itemId("dup"), providerCorrelationId: "c1" },
          { itemId: itemId("dup"), providerCorrelationId: "c2" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects duplicate provider correlation ids", () => {
    const result = batchInferenceCreateJobRequestSchema.safeParse(
      minimalCreateRequest({
        items: [
          { itemId: itemId("i1"), providerCorrelationId: "same" },
          { itemId: itemId("i2"), providerCorrelationId: "same" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown format version", () => {
    const result = batchInferenceCreateJobRequestSchema.safeParse({
      ...minimalCreateRequest(),
      formatVersion: "99",
    });
    expect(result.success).toBe(false);
  });

  it("requires workspace id", () => {
    const raw = minimalCreateRequest();
    const result = batchInferenceCreateJobRequestSchema.safeParse({
      ...raw,
      workspaceId: "",
    });
    expect(result.success).toBe(false);
  });

  it("enforces item count upper bound", () => {
    expect(BATCH_INFERENCE_MAX_ITEM_COUNT).toBeGreaterThan(0);
    const tooMany = Array.from(
      { length: BATCH_INFERENCE_MAX_ITEM_COUNT + 1 },
      (_, i) => ({
        itemId: itemId(`item_${i}`),
        providerCorrelationId: `corr_${i}`,
        input: { messages: [{ role: "user" as const, content: "x" }] },
      }),
    );
    const result = batchInferenceCreateJobRequestSchema.safeParse({
      ...minimalCreateRequest(),
      items: tooMany,
    });
    expect(result.success).toBe(false);
  });
});

describe("batch inference item id validation", () => {
  it("detects duplicate ids", () => {
    expect(
      validateUniqueBatchInferenceItemIds([itemId("a"), itemId("b")]).ok,
    ).toBe(true);
    const bad = validateUniqueBatchInferenceItemIds([itemId("a"), itemId("a")]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.duplicateId).toBe(itemId("a"));
    }
  });
});

describe("batch inference provider correlation partition", () => {
  it("keeps first occurrence and flags duplicate and unexpected ids", () => {
    const partition = partitionBatchInferenceProviderCorrelations(
      ["a", "b"],
      [
        { providerCorrelationId: "b" },
        { providerCorrelationId: "a" },
        { providerCorrelationId: "a" },
        { providerCorrelationId: "z" },
      ],
    );
    expect(partition.applicable).toHaveLength(2);
    expect(partition.duplicateCorrelationIds).toEqual(["a"]);
    expect(partition.unexpectedCorrelationIds).toEqual(["z"]);
    expect(partition.missingCorrelationIds).toEqual([]);
    expect(partition.hasCorrelationAnomaly).toBe(true);
  });

  it("detects missing expected correlation ids", () => {
    const partition = partitionBatchInferenceProviderCorrelations(
      ["a", "b", "c"],
      [{ providerCorrelationId: "a" }],
    );
    expect(partition.missingCorrelationIds).toEqual(["b", "c"]);
    expect(partition.hasCorrelationAnomaly).toBe(false);
  });
});

describe("batch inference reconciliation", () => {
  const expected = [itemId("a"), itemId("b"), itemId("c")];

  function outcome(
    id: string,
    status: BatchInferenceItemOutcome["status"] = "SUCCEEDED",
  ): BatchInferenceItemOutcome {
    return {
      itemId: itemId(id),
      providerCorrelationId: `corr_${id}`,
      status,
    };
  }

  it("is complete when all items match in any order", () => {
    const report = reconcileBatchInferenceItemOutcomes(expected, [
      outcome("c"),
      outcome("a"),
      outcome("b"),
    ]);
    expect(report.isComplete).toBe(true);
    expect(report.missingItemIds).toHaveLength(0);
  });

  it("detects missing results", () => {
    const report = reconcileBatchInferenceItemOutcomes(expected, [
      outcome("a"),
    ]);
    expect(report.isComplete).toBe(false);
    expect(report.missingItemIds).toEqual([itemId("b"), itemId("c")]);
  });

  it("detects duplicate results", () => {
    const report = reconcileBatchInferenceItemOutcomes(expected, [
      outcome("a"),
      outcome("a"),
      outcome("b"),
      outcome("c"),
    ]);
    expect(report.duplicateItemIds).toEqual([itemId("a")]);
    expect(report.isComplete).toBe(false);
  });

  it("detects unexpected results", () => {
    const report = reconcileBatchInferenceItemOutcomes(expected, [
      outcome("a"),
      outcome("b"),
      outcome("c"),
      outcome("z"),
    ]);
    expect(report.unexpectedItemIds).toEqual([itemId("z")]);
  });
});

describe("batch inference job status transitions", () => {
  it("allows progress from CREATED through PROCESSING to COMPLETED", () => {
    expect(canTransitionBatchInferenceJobStatus("CREATED", "SUBMITTING")).toBe(
      true,
    );
    expect(
      canTransitionBatchInferenceJobStatus("PROCESSING", "COMPLETED"),
    ).toBe(true);
    assertBatchInferenceJobStatusTransition("PROCESSING", "COMPLETED");
  });

  it("allows partial completion and cancellation paths", () => {
    expect(
      canTransitionBatchInferenceJobStatus("PROCESSING", "PARTIALLY_COMPLETED"),
    ).toBe(true);
    expect(
      canTransitionBatchInferenceJobStatus("SUBMITTED", "CANCELLING"),
    ).toBe(true);
    expect(
      canTransitionBatchInferenceJobStatus("CANCELLING", "CANCELLED"),
    ).toBe(true);
    expect(canTransitionBatchInferenceJobStatus("SUBMITTING", "EXPIRED")).toBe(
      true,
    );
  });

  it("blocks regression from terminal states", () => {
    for (const terminal of [
      "COMPLETED",
      "PARTIALLY_COMPLETED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ] as const) {
      expect(isBatchInferenceTerminalJobStatus(terminal)).toBe(true);
      expect(canTransitionBatchInferenceJobStatus(terminal, "PROCESSING")).toBe(
        false,
      );
    }
  });

  it("throws on illegal transition", () => {
    expect(() =>
      assertBatchInferenceJobStatusTransition("COMPLETED", "FAILED"),
    ).toThrow(/Illegal batch inference job status transition/);
  });
});

describe("batch inference policy and capabilities", () => {
  it("defaults batch enablement to off", () => {
    expect(createDefaultBatchInferenceEligibilityPolicy()).toEqual({
      batchInferenceEnabled: false,
      denySensitiveWorkloads: true,
      maxItemCount: BATCH_INFERENCE_MAX_ITEM_COUNT,
    });
  });

  it("documents provider capability matrix for all model providers", () => {
    expect(
      BATCH_INFERENCE_PROVIDER_CAPABILITIES.OPENAI.supportsNativeBatch,
    ).toBe(true);
    expect(
      BATCH_INFERENCE_PROVIDER_CAPABILITIES.ANTHROPIC.supportsNativeBatch,
    ).toBe(true);
    expect(
      BATCH_INFERENCE_PROVIDER_CAPABILITIES.GOOGLE_GEMINI.supportsNativeBatch,
    ).toBe(true);
    expect(
      BATCH_INFERENCE_PROVIDER_CAPABILITIES.GOOGLE_GEMINI.correlationIdField,
    ).toBe("provider_defined");
  });
});
