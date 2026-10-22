import { describe, expect, it } from "vitest";

import {
  createEmptyCaseDraft,
  createEmptyVersionDraft,
} from "../src/client/lib/evaluation-suite-builder-draft";
import {
  findDuplicateCaseKeys,
  validateDraftForPublish,
} from "../src/client/lib/evaluation-suite-builder-validation";

describe("evaluation suite builder validation", () => {
  it("rejects invalid JSON and duplicate case keys", () => {
    const first = createEmptyCaseDraft();
    const second = createEmptyCaseDraft();
    const draft = {
      ...createEmptyVersionDraft({
        workspaceId: "ws-1",
        evaluationSuiteId: "suite-1",
      }),
      cases: [
        { ...first, key: "alpha", inputJson: "{", expectedOutputJson: "{}" },
        {
          ...second,
          key: "alpha",
          inputJson: '{"prompt":"x"}',
          expectedOutputJson: '{"echo":"x"}',
        },
      ],
    };

    expect(findDuplicateCaseKeys(draft.cases)).toHaveLength(2);

    const result = validateDraftForPublish(draft);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation failure");
    }
    expect(
      result.fieldErrors.some((error) =>
        error.message.includes("Invalid JSON"),
      ),
    ).toBe(true);
    expect(
      result.fieldErrors.some((error) =>
        error.message.includes("Duplicate case key"),
      ),
    ).toBe(true);
  });

  it("builds JSON_EXACT_MATCH case definitions for publish", () => {
    const evaluationCase = createEmptyCaseDraft();
    const draft = {
      ...createEmptyVersionDraft({
        workspaceId: "ws-1",
        evaluationSuiteId: "suite-1",
      }),
      cases: [
        {
          ...evaluationCase,
          key: "smoke",
          inputJson: '{"prompt":"hello"}',
          expectedOutputJson: '{"echo":"hello"}',
        },
      ],
    };

    const result = validateDraftForPublish(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected validation success");
    }
    expect(result.cases).toEqual([
      {
        key: "smoke",
        input: { prompt: "hello" },
        expected: { echo: "hello" },
        evaluator: {
          type: "JSON_EXACT_MATCH",
          expected: { echo: "hello" },
        },
      },
    ]);
  });
});
