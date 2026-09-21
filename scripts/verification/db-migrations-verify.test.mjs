import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("db:migrations:verify harness", () => {
  it("passes against the committed migration history manifest", () => {
    const result = spawnSync("pnpm", ["db:migrations:verify"], {
      cwd: REPO_ROOT,
      shell: true,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Migration history verified/);
  });
});
