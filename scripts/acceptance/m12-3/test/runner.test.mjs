import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

test("M12.3 acceptance runner documents entry point", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  assert.equal(typeof pkg.scripts["acceptance:m12-3"], "string");
  assert.match(pkg.scripts["acceptance:m12-3"], /m12-3\/run\.mjs/);
});

test("M12.3 integration tests exist", () => {
  const cross = path.join(
    REPO_ROOT,
    "apps/console/test/integration/m12-3-cross-capability.integration.test.ts",
  );
  assert.ok(fs.existsSync(cross));
});
