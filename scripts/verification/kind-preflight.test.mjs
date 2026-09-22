import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { KUBECTL_PREFLIGHT_ARGS } from "../deployment/kind-preflight.mjs";

describe("kind preflight", () => {
  it("uses kubectl client-only version check", () => {
    assert.deepEqual(KUBECTL_PREFLIGHT_ARGS, ["version", "--client"]);
  });
});
