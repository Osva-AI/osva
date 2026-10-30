import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSecrets, assertRedacted } from "../redact.mjs";

describe("m16-2d acceptance helpers", () => {
  it("redacts API keys from diagnostic text", () => {
    const redacted = redactSecrets(
      "token osva_ak_test.secretpart and POSTGRES_PASSWORD=abcdef0123456789012345678901234567890123456789012345678901234",
    );
    assert.equal(redacted.includes("osva_ak_test.secretpart"), false);
    assertRedacted(redacted);
  });
});
