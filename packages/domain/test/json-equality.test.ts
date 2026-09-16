import { describe, expect, it } from "vitest";

import { jsonValuesEqual } from "../src/json-equality.js";

describe("jsonValuesEqual", () => {
  it("ignores object property order", () => {
    expect(jsonValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("detects structural differences", () => {
    expect(jsonValuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
