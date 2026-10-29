import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGroups } from "../lib/groups.mjs";

describe("parseGroups", () => {
  it("expands workflow to include stack without forcing consumers", () => {
    const prev = process.env.OSVA_R11_GROUPS;
    process.env.OSVA_R11_GROUPS = "workflow";
    try {
      const groups = parseGroups([]);
      assert.ok(groups.has("stack"));
      assert.ok(groups.has("workflow"));
      assert.equal(groups.has("consumers"), false);
    } finally {
      if (prev === undefined) {
        delete process.env.OSVA_R11_GROUPS;
      } else {
        process.env.OSVA_R11_GROUPS = prev;
      }
    }
  });
});
