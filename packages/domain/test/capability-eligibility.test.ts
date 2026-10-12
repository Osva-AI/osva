import type { RunAttemptId, RunId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { selectCapabilityEligibleRunAttempt } from "../src/capability-eligibility.js";
import { RunAttempt } from "../src/run-attempt.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:30.000Z");

function runningAttempt(): RunAttempt {
  return RunAttempt.createFirst({
    id: "ra-1" as RunAttemptId,
    runId: "run-1" as RunId,
    createdAt: NOW,
  }).transitionTo("RUNNING", NOW);
}

describe("capability eligibility", () => {
  it("allows legacy unleased RUNNING attempts", () => {
    expect(
      selectCapabilityEligibleRunAttempt(runningAttempt(), LATER),
    ).not.toBeNull();
  });

  it("allows a leased attempt only while store time is before expiry", () => {
    const leased = runningAttempt().withExecutionLease({
      owner: "worker-1",
      generation: 1,
      expiresAt: LATER,
    });
    expect(selectCapabilityEligibleRunAttempt(leased, NOW)).not.toBeNull();
    expect(selectCapabilityEligibleRunAttempt(leased, LATER)).toBeNull();
  });

  it("rejects terminal attempts", () => {
    const failed = runningAttempt().transitionTo("FAILED", LATER, {
      error: { code: "EXECUTION_INTERRUPTED", message: "lost" },
    });
    expect(selectCapabilityEligibleRunAttempt(failed, LATER)).toBeNull();
  });
});
