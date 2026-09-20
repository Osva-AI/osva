import type { RunAttemptId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { runtimeArtifactIdempotencyKey } from "../src/artifact-runtime.js";

describe("runtimeArtifactIdempotencyKey", () => {
  it("scopes caller keys to the run attempt", () => {
    const attempt = "attempt-1" as RunAttemptId;
    expect(runtimeArtifactIdempotencyKey(attempt, "upload-1")).toBe(
      "artifact-runtime:attempt-1:upload-1",
    );
  });

  it("returns undefined when the caller omits a key", () => {
    const attempt = "attempt-1" as RunAttemptId;
    expect(runtimeArtifactIdempotencyKey(attempt, undefined)).toBeUndefined();
  });
});
