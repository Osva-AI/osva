import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyScenarioError,
  failsMandatoryGroup,
} from "../lib/scenario-status.js";

describe("acceptance scenario status classification", () => {
  it("maps NOT_RUN prefix to NOT_RUN", () => {
    assert.equal(
      classifyScenarioError("NOT_RUN: browser automation unavailable"),
      "NOT_RUN",
    );
  });

  it("maps BLOCKED prefix to BLOCKED", () => {
    assert.equal(
      classifyScenarioError("BLOCKED: Kind/kubectl/helm prerequisite missing"),
      "BLOCKED",
    );
  });

  it("maps other errors to FAIL", () => {
    assert.equal(classifyScenarioError("assertion failed"), "FAIL");
  });

  it("fails mandatory group on mandatory BLOCKED or FAIL only", () => {
    assert.equal(failsMandatoryGroup("BLOCKED", true), true);
    assert.equal(failsMandatoryGroup("FAIL", true), true);
    assert.equal(failsMandatoryGroup("NOT_RUN", true), false);
    assert.equal(failsMandatoryGroup("PASS", true), false);
    assert.equal(failsMandatoryGroup("BLOCKED", false), false);
    assert.equal(failsMandatoryGroup("NOT_RUN", false), false);
  });
});
