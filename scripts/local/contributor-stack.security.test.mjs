import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const LOCAL_DIR = path.join(REPO_ROOT, "scripts", "local");

/** @param {string} name */
function readLocalScript(name) {
  return fs.readFileSync(path.join(LOCAL_DIR, name), "utf8");
}

const FORBIDDEN_IN_START_AND_PROCESS = [
  /\$env:OSVA_AUTH_SECRET\s*=/,
  /\$env:OSVA_RUNTIME_CAPABILITY_SECRET\s*=/,
  /\$env:OPENAI_API_KEY\s*=/,
  /\bCommandBody\b/,
  /"-Command"/,
  /'-Command'/,
  /\s-Command\s/,
];

describe("contributor stack script security", () => {
  it("starts managed processes via -File launcher without inline secret assignment", () => {
    const start = readLocalScript("start-contributor-stack.ps1");
    const process = readLocalScript("contributor-stack-process.ps1");
    for (const pattern of FORBIDDEN_IN_START_AND_PROCESS) {
      assert.doesNotMatch(
        start,
        pattern,
        `start-contributor-stack.ps1: ${pattern}`,
      );
      assert.doesNotMatch(
        process,
        pattern,
        `contributor-stack-process.ps1: ${pattern}`,
      );
    }
    assert.match(process, /"-File", \$launcher/);
    assert.match(process, /run-contributor-service\.ps1/);
  });

  it("loads secrets only through load-contributor-env in the service launcher", () => {
    const launcher = readLocalScript("run-contributor-service.ps1");
    assert.match(launcher, /load-contributor-env\.ps1/);
    assert.doesNotMatch(launcher, /\$env:OSVA_AUTH_SECRET\s*=/);
    assert.doesNotMatch(launcher, /\$env:OSVA_RUNTIME_CAPABILITY_SECRET\s*=/);
  });

  it("documents safe wrapper command-line checks", () => {
    const process = readLocalScript("contributor-stack-process.ps1");
    assert.match(process, /Test-ContributorStackWrapperCommandLineSafe/);
  });

  it("keeps PID metadata free of credential field names", () => {
    const process = readLocalScript("contributor-stack-process.ps1");
    const pidBlock = process.slice(
      process.indexOf("function Write-ContributorStackPidFile"),
      process.indexOf("function Get-ContributorPostgresHostPort"),
    );
    assert.doesNotMatch(pidBlock, /AUTH_SECRET/);
    assert.doesNotMatch(pidBlock, /API_KEY/);
    assert.doesNotMatch(pidBlock, /RUNTIME_CAPABILITY_SECRET/);
  });
});
