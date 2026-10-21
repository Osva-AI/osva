import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitNullDelimitedPaths, resolveBaseCommit } from "./branch-git.mjs";

describe("branch git path parsing", () => {
  it("parses NUL-delimited paths including spaces", () => {
    const parsed = splitNullDelimitedPaths(
      "apps/console/a.ts\0apps/console/my file.ts\0",
    );
    assert.deepEqual(parsed, ["apps/console/a.ts", "apps/console/my file.ts"]);
  });

  it("returns empty array for empty buffer", () => {
    assert.deepEqual(splitNullDelimitedPaths(""), []);
  });

  it("fails clearly when base ref is missing", async () => {
    const result = await resolveBaseCommit(
      "refs/heads/__osva_missing_base_for_test__",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /not a reachable commit/i);
      assert.match(result.message, /git fetch/i);
    }
  });
});
