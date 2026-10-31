import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceReport } from "../report.mjs";

describe("AcceptanceReport journey aggregation", () => {
  it("fails parent journey when any child step failed", () => {
    const report = new AcceptanceReport();
    report.record("upgrade_bootstrap_compose", "bootstrap", "FAIL");
    assert.equal(report.journeyStatusFromChildren("upgrade_"), "FAIL");
  });

  it("passes parent journey when all child steps passed", () => {
    const report = new AcceptanceReport();
    report.record("upgrade_bootstrap_compose", "bootstrap", "PASS");
    report.record("upgrade_execute", "execute", "PASS");
    assert.equal(report.journeyStatusFromChildren("upgrade_"), "PASS");
  });

  it("treats WARN child steps as non-failing", () => {
    const report = new AcceptanceReport();
    report.record("upgrade_execute", "execute", "PASS");
    report.record("upgrade_status_after", "status", "WARN");
    assert.equal(report.journeyStatusFromChildren("upgrade_"), "PASS");
  });

  it("returns NOT_RUN when no child steps were recorded", () => {
    const report = new AcceptanceReport();
    assert.equal(report.journeyStatusFromChildren("upgrade_"), "NOT_RUN");
  });

  it("fails parent journey when a child is SKIP or missing", () => {
    const report = new AcceptanceReport();
    report.record("compose_config", "compose", "PASS");
    report.record("platform_services_ready", "ready", "SKIP");
    assert.equal(
      report.journeyStatusFromChildIds([
        "compose_config",
        "platform_services_ready",
        "console_ready",
      ]),
      "FAIL",
    );
  });

  it("fails parent journey when expected child ids were not recorded", () => {
    const report = new AcceptanceReport();
    report.record("compose_config", "compose", "PASS");
    assert.equal(
      report.journeyStatusFromChildIds(["compose_config", "platform_stop"]),
      "FAIL",
    );
  });

  it("passes parent journey when all explicit child ids passed", () => {
    const report = new AcceptanceReport();
    report.record("compose_config", "compose", "PASS");
    report.record("platform_stop", "stop", "PASS");
    assert.equal(
      report.journeyStatusFromChildIds(["compose_config", "platform_stop"]),
      "PASS",
    );
  });
});
