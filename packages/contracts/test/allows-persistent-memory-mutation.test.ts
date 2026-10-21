import type { EvaluationCaseId, EvaluationRunId } from "../src/ids.js";
import { describe, expect, it } from "vitest";

import { allowsPersistentMemoryMutation } from "../src/runtime-protocol.js";

describe("allowsPersistentMemoryMutation", () => {
  it("allows mutation for ordinary production runs", () => {
    expect(allowsPersistentMemoryMutation({})).toBe(true);
  });

  it("denies mutation for evaluation child runs", () => {
    expect(
      allowsPersistentMemoryMutation({
        evaluationContext: {
          evaluationRunId: "eval-run-1" as EvaluationRunId,
          evaluationCaseId: "eval-case-1" as EvaluationCaseId,
        },
      }),
    ).toBe(false);
  });

  it("denies mutation when restrictPersistentMemory is set", () => {
    expect(
      allowsPersistentMemoryMutation({ restrictPersistentMemory: true }),
    ).toBe(false);
  });
});
