import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrationRequiredFromDryRun } from "../lib/upgrade-journey.mjs";

describe("migrationRequiredFromDryRun", () => {
  it("detects when migrations are required", () => {
    assert.equal(
      migrationRequiredFromDryRun(
        "OSVA platform upgrade dry-run\n\nMigration required: yes\n",
      ),
      true,
    );
  });

  it("detects when migrations are not required", () => {
    assert.equal(
      migrationRequiredFromDryRun(
        "OSVA platform upgrade dry-run\n\nMigration required: no\n",
      ),
      false,
    );
  });
});
