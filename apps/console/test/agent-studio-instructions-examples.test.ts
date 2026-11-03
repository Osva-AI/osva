import { describe, expect, it } from "vitest";

import {
  mergeExamplesIntoInstructions,
  removeExamplesFromInstructions,
  splitInstructionsAndExamples,
} from "../src/client/lib/agent-studio-instructions-examples";

describe("agent studio instructions and examples", () => {
  it("splits and merges example blocks without silent duplication", () => {
    const merged = mergeExamplesIntoInstructions(
      "Base instructions.",
      "User: Hello",
    );
    const split = splitInstructionsAndExamples(merged);
    expect(split.baseInstructions).toBe("Base instructions.");
    expect(split.examples).toBe("User: Hello");
    expect(
      mergeExamplesIntoInstructions(split.baseInstructions, split.examples),
    ).toBe(merged);
  });

  it("removes examples while preserving base instructions", () => {
    const merged = mergeExamplesIntoInstructions("Keep this.", "Sample");
    expect(removeExamplesFromInstructions(merged)).toBe("Keep this.");
  });
});
