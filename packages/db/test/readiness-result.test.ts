import { describe, expect, it } from "vitest";

import {
  collectDependencyReadiness,
  readinessFailureBody,
  ReadinessUnavailableError,
} from "../src/readiness-result.js";

describe("readiness result", () => {
  it("omits dependency fields when none failed", () => {
    expect(readinessFailureBody([])).toEqual({ status: "unavailable" });
  });

  it("reports a single failed dependency", () => {
    expect(readinessFailureBody(["postgres"])).toEqual({
      status: "unavailable",
      failedDependency: "postgres",
    });
    expect(readinessFailureBody(["valkey"])).toEqual({
      status: "unavailable",
      failedDependency: "valkey",
    });
  });

  it("reports simultaneous failures without hostnames or URLs", () => {
    const body = readinessFailureBody(["postgres", "valkey"]);
    expect(body).toEqual({
      status: "unavailable",
      failedDependency: "postgres",
      failedDependencies: ["postgres", "valkey"],
    });
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
  });

  it("collects independent dependency failures", async () => {
    const snapshot = await collectDependencyReadiness([
      {
        name: "postgres",
        check: async () => {
          throw new Error("postgres://secret@127.0.0.1/osva");
        },
      },
      {
        name: "valkey",
        check: async () => {
          throw new Error("redis://secret@127.0.0.1");
        },
      },
    ]);
    expect(snapshot).toEqual({
      ready: false,
      failedDependencies: ["postgres", "valkey"],
    });
    expect(
      new ReadinessUnavailableError(snapshot.failedDependencies).message,
    ).not.toContain("secret");
  });
});
