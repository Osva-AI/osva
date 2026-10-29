import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RC4_TARGET,
  STABLE_110_TARGET,
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

  it("blocks stable target until registry digests are recorded", () => {
    const readiness = stableTargetReadiness(STABLE_110_TARGET);
    assert.equal(readiness.blocked, true);
    assert.match(readiness.reason, /not ready/);
  });

  it("allows RC4 target when artifacts are ready", () => {
    assert.equal(stableTargetReadiness(RC4_TARGET).blocked, false);
  });
});
