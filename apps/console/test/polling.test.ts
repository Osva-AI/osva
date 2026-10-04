import { describe, expect, it } from "vitest";

import {
  isAttemptLive,
  isAttemptTerminal,
  isRunLive,
  isRunTerminal,
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
});
