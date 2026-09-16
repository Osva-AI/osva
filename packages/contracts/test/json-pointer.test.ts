import { describe, expect, it } from "vitest";

import { isValidJsonPointer, resolveJsonPointer } from "../src/json-pointer.js";

describe("JSON Pointer", () => {
  it("accepts empty and slash-prefixed pointers", () => {
    expect(isValidJsonPointer("")).toBe(true);
    expect(isValidJsonPointer("/category")).toBe(true);
    expect(isValidJsonPointer("/a~1b")).toBe(true);
    expect(isValidJsonPointer("category")).toBe(false);
    expect(isValidJsonPointer("/a~2")).toBe(false);
  });

  it("resolves object and array paths and treats missing paths as not found", () => {
    const document = {
      category: "sales",
      nested: { "~": 1 },
      items: ["a", "b"],
    };

    expect(resolveJsonPointer(document, "")).toEqual({
      found: true,
      value: document,
    });
    expect(resolveJsonPointer(document, "/category")).toEqual({
      found: true,
      value: "sales",
    });
    expect(resolveJsonPointer(document, "/missing")).toEqual({ found: false });
    expect(resolveJsonPointer(document, "/items/1")).toEqual({
      found: true,
      value: "b",
    });
    expect(resolveJsonPointer(document, "/items/9")).toEqual({ found: false });
    expect(resolveJsonPointer(document, "/a~0")).toEqual({ found: false });
  });
});
