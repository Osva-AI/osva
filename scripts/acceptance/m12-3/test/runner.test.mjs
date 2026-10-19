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
  const browser = path.join(
    REPO_ROOT,
    "apps/console/test/integration/m12-3-browser.integration.test.ts",
  );
  assert.ok(fs.existsSync(cross));
  assert.ok(fs.existsSync(browser));
});

test("Console default integration config excludes Playwright browser tests", () => {
  const configPath = path.join(
    REPO_ROOT,
    "apps/console/vitest.integration.config.ts",
  );
  const source = fs.readFileSync(configPath, "utf8");
  assert.match(source, /exclude:.*browser\.integration\.test\.ts/s);
});

test("M12.3 browser CI entry point avoids redundant BFF rerun", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  assert.match(pkg.scripts["acceptance:m12-3:browser-ci"], /--browser-only/);
});
