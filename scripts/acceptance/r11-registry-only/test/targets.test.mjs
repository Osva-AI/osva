import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  M16_111_TARGET,
  RC4_TARGET,
  STABLE_110_TARGET,
  STABLE_NPM_111_TARGET,
  resolveAcceptanceTarget,
  stableTargetReadiness,
} from "../lib/targets.mjs";

describe("registry acceptance targets", () => {
  it("defaults to RC4 when env unset", () => {
    const prev = process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
    delete process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
    try {
      assert.equal(resolveAcceptanceTarget().id, "rc4");
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
      } else {
        process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET = prev;
      }
    }
  });

  it("allows stable target when published digests are recorded", () => {
    assert.equal(stableTargetReadiness(STABLE_110_TARGET).blocked, false);
  });

  it("allows RC4 target when artifacts are ready", () => {
    assert.equal(stableTargetReadiness(RC4_TARGET).blocked, false);
  });

  it("blocks m16-111 until publication digests are recorded", () => {
    assert.equal(stableTargetReadiness(M16_111_TARGET).blocked, true);
  });

  it("resolves m16-111 target id", () => {
    const prev = process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
    process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET = "m16-111";
    try {
      assert.equal(resolveAcceptanceTarget().id, "m16-111");
      assert.equal(resolveAcceptanceTarget().npmPackageVersion, "1.1.2");
      assert.equal(resolveAcceptanceTarget().productVersion, "1.1.1");
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
      } else {
        process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET = prev;
      }
    }
  });

  it("resolves stable-npm-111 corrective target", () => {
    const prev = process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
    process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET = "stable-npm-111";
    try {
      const target = resolveAcceptanceTarget();
      assert.equal(target.id, "stable-npm-111");
      assert.equal(target.productVersion, "1.1.0");
      assert.equal(target.npmPackageVersion, "1.1.1");
      assert.equal(target.pythonPep440, "1.1.0");
      assert.equal(target.correctiveNpmDistributionOnly, true);
      assert.equal(stableTargetReadiness(target).blocked, false);
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET;
      } else {
        process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET = prev;
      }
    }
  });
});
