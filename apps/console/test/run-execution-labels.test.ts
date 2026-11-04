import { describe, expect, it } from "vitest";

import { runExecutionStatusLabel } from "../src/client/lib/run-execution-labels";

describe("runExecutionStatusLabel", () => {
  it("distinguishes queued from running", () => {
    expect(runExecutionStatusLabel("QUEUED")).toBe("Queued");
    expect(runExecutionStatusLabel("RUNNING")).toBe("Running");
  });
});
