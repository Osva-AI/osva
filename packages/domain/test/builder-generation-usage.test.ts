import { describe, expect, it } from "vitest";

import { mergeBuilderModelUsage } from "../src/builder/builder-generation-usage.js";

describe("mergeBuilderModelUsage", () => {
  it("returns prior aggregate when an attempt omits usage", () => {
    const first = mergeBuilderModelUsage(undefined, {
      inputUnits: 4,
      outputUnits: 2,
    });
    const second = mergeBuilderModelUsage(first, undefined);
    expect(second).toEqual(first);
  });

  it("aggregates token units across attempts", () => {
    const first = mergeBuilderModelUsage(undefined, {
      inputUnits: 10,
      outputUnits: 5,
    });
    expect(first?.usageMeasured).toBe(true);
    expect(first?.inputUnits).toBe(10);

    const second = mergeBuilderModelUsage(first, {
      inputUnits: 3,
      outputUnits: 7,
      cachedUnits: 2,
    });
    expect(second).toEqual({
      inputUnits: 13,
      outputUnits: 12,
      cachedUnits: 2,
      usageMeasured: true,
    });
  });
});
