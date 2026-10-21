import { describe, expect, it } from "vitest";

import {
  buildJsonFromGuidedValues,
  listGuidedRunInputFields,
} from "../src/client/lib/workflow-run-input-guided";

describe("guided workflow run input", () => {
  it("lists simple object schema fields", () => {
    const fields = listGuidedRunInputFields({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        active: { type: "boolean" },
      },
    });
    expect(fields?.map((field) => field.key)).toEqual([
      "name",
      "count",
      "active",
    ]);
  });

  it("builds JSON from guided values", () => {
    const fields = listGuidedRunInputFields({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    })!;
    const built = buildJsonFromGuidedValues(fields, {
      name: "Demo",
      count: "2",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value).toEqual({ name: "Demo", count: 2 });
    }
  });
});
