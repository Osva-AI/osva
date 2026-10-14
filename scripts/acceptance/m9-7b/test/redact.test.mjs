import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactValue } from "../lib/redact.js";

describe("acceptance evidence redaction", () => {
  it("redacts bearer tokens and database URLs", () => {
    const value = redactValue({
      authorization: "Bearer osva_ak_abc.def",
      OSVA_DATABASE_URL: "postgres://user:secret@127.0.0.1:5432/osva",
      nested: { token: "should-redact" },
      safe: "ok",
    });
    assert.equal(value.authorization, "Bearer [REDACTED]");
    assert.match(String(value.OSVA_DATABASE_URL), /\[REDACTED\]/);
    assert.equal(value.nested.token, "[REDACTED]");
    assert.equal(value.safe, "ok");
  });
});
