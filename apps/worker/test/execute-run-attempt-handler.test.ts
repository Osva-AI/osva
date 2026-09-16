import { describe, expect, it } from "vitest";
import type { RunAttemptId } from "@osva/contracts";

import { createExecuteRunAttemptHandler } from "../src/execute-run-attempt-handler.js";

describe("createExecuteRunAttemptHandler", () => {
  it("forwards only runAttemptId and clock time into ExecuteRunAttempt", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const received: { runAttemptId: string; now: Date }[] = [];
    const handler = createExecuteRunAttemptHandler(
      {
        async execute(command) {
          received.push(command);
          return {
            outcome: "already-terminal",
            run: {} as never,
            runAttempt: {} as never,
          };
        },
      },
      { now: () => now },
    );

    await handler({ runAttemptId: "attempt-1" as RunAttemptId });

    expect(received).toEqual([{ runAttemptId: "attempt-1", now }]);
    expect(Object.keys(received[0] ?? {})).toEqual(["runAttemptId", "now"]);
  });
});
