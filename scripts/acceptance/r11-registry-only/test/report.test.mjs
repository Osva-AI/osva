import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceReport } from "../report.mjs";

describe("AcceptanceReport", () => {
  it("returns exit code 1 when any journey failed", () => {
    const report = new AcceptanceReport();
    report.record("a", "A", "PASS");
    report.record("b", "B", "FAIL", { detail: "boom" });
    assert.equal(report.exitCode(), 1);
  });

  it("returns exit code 2 when blocked without failures", () => {
    const report = new AcceptanceReport();
    report.record("a", "A", "NOT_RUN");
    report.record("b", "B", "BLOCKED");
    assert.equal(report.exitCode(), 2);
  });

  it("returns exit code 0 when all recorded journeys passed", () => {
    const report = new AcceptanceReport();
    report.record("a", "A", "PASS");
    report.record("b", "B", "NOT_RUN");
    assert.equal(report.exitCode(), 0);
  });
});
