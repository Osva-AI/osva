import { describe, expect, it } from "vitest";

import {
  isAttemptLive,
  isAttemptTerminal,
  isRunLive,
  isRunTerminal,
  isWorkflowRunLive,
  isWorkflowRunTerminal,
} from "../src/client/lib/statuses";

describe("polling status helpers", () => {
  it("treats active run states as live", () => {
    expect(isRunLive("RUNNING")).toBe(true);
    expect(isRunTerminal("SUCCEEDED")).toBe(true);
    expect(isRunLive("SUCCEEDED")).toBe(false);
  });

  it("treats active attempt states as live", () => {
    expect(isAttemptLive("PENDING")).toBe(true);
    expect(isAttemptLive("RUNNING")).toBe(true);
    expect(isAttemptTerminal("FAILED")).toBe(true);
    expect(isAttemptLive("SUCCEEDED")).toBe(false);
  });

  it("treats active workflow run states as live", () => {
    expect(isWorkflowRunLive("PENDING")).toBe(true);
    expect(isWorkflowRunLive("RUNNING")).toBe(true);
    expect(isWorkflowRunLive("WAITING")).toBe(true);
    expect(isWorkflowRunTerminal("SUCCEEDED")).toBe(true);
    expect(isWorkflowRunLive("SUCCEEDED")).toBe(false);
  });
});
