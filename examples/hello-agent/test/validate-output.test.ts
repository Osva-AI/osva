import { describe, expect, it } from "vitest";

import { validateHelloOutput } from "../scripts/lib/validate-output.js";

describe("Hello output validation", () => {
  it("accepts matching echoed output", () => {
    expect(validateHelloOutput({ echoed: "Hello OSVA" }, "Hello OSVA")).toEqual(
      {
        ok: true,
      },
    );
  });

  it("rejects mismatched echoed output", () => {
    const result = validateHelloOutput({ echoed: "other" }, "Hello OSVA");
    expect(result.ok).toBe(false);
  });
});
