import { describe, expect, it } from "vitest";
import type { Page } from "playwright";

import { evaluationRunIdFromPage } from "./integration/m13-7-5-browser-helpers.js";

describe("m13-7-5 browser helpers", () => {
  it("parses evaluation run id from Console detail URL", () => {
    const page = {
      url: () =>
        "http://127.0.0.1:4400/testing/runs/eval-run-abc123?tab=summary",
    } as Page;
    expect(evaluationRunIdFromPage(page)).toBe("eval-run-abc123");
  });

  it("rejects URLs that are not on the run detail route", () => {
    const page = {
      url: () => "http://127.0.0.1:4400/testing/suites",
    } as Page;
    expect(() => evaluationRunIdFromPage(page)).toThrow(/Evaluation run id/);
  });
});
