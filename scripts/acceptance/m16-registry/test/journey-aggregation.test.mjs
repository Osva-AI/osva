import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceReport } from "../../m16-2d/report.mjs";
import {
  REGISTRY_INSTALL_JOURNEY_CHILD_IDS,
  REGISTRY_LIFECYCLE_JOURNEY_CHILD_IDS,
  registryInstallJourneyStatus,
  registryLifecycleJourneyStatus,
  registryUpgradeJourneyStatus,
} from "../lib/journey-aggregation.mjs";

describe("registry journey aggregation", () => {
  it("lists every install child id used by the registry install group", () => {
    assert.ok(REGISTRY_INSTALL_JOURNEY_CHILD_IDS.includes("compose_config"));
    assert.ok(
      REGISTRY_INSTALL_JOURNEY_CHILD_IDS.includes("first_agent_run_succeeded"),
    );
    assert.equal(REGISTRY_INSTALL_JOURNEY_CHILD_IDS.length, 15);
  });

  it("fails install journey when any install child fails", () => {
    const report = new AcceptanceReport();
    for (const id of REGISTRY_INSTALL_JOURNEY_CHILD_IDS) {
      report.record(id, id, id === "compose_config" ? "FAIL" : "PASS");
    }
    assert.equal(registryInstallJourneyStatus(report), "FAIL");
  });

  it("passes lifecycle journey when children are PASS or WARN", () => {
    const report = new AcceptanceReport();
    for (const id of REGISTRY_LIFECYCLE_JOURNEY_CHILD_IDS) {
      report.record(
        id,
        id,
        id === "platform_status" || id === "platform_doctor" ? "WARN" : "PASS",
      );
    }
    assert.equal(registryLifecycleJourneyStatus(report), "PASS");
  });

  it("fails upgrade journey when bootstrap child fails", () => {
    const report = new AcceptanceReport();
    report.record("upgrade_bootstrap_compose", "bootstrap", "FAIL");
    assert.equal(registryUpgradeJourneyStatus(report), "FAIL");
  });
});
