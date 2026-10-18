import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CI_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

describe("CI compose-smoke auth configuration", () => {
  it("sets test-only OSVA_AUTH_SECRET for web startup on clean runners", () => {
    const workflow = fs.readFileSync(CI_WORKFLOW, "utf8");
    const composeSmokeBlock = workflow.slice(
      workflow.indexOf("compose-smoke:"),
    );
    assert.match(
      composeSmokeBlock,
      /OSVA_AUTH_SECRET: ci-compose-smoke-test-osva-auth-secret-32/,
    );
    assert.match(
      composeSmokeBlock,
      /OSVA_AUTH_BASE_URL: http:\/\/127\.0\.0\.1:3000/,
    );
    assert.match(
      composeSmokeBlock,
      /OSVA_AUTH_TRUSTED_ORIGINS: http:\/\/127\.0\.0\.1:3000/,
    );
    assert.doesNotMatch(composeSmokeBlock, /\$\{\{\s*secrets\./);
  });
});
