import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("M10.2E acceptance", () => {
  it("documents opt-in live gate in the runner", async () => {
    const runner = await readFile(
      path.join(REPO_ROOT, "scripts", "acceptance", "m10-2e", "run.mjs"),
      "utf8",
    );
    assert.match(runner, /OSVA_ACCEPTANCE_LIVE/);
    assert.match(runner, /reusedAgentVersion/);
    assert.match(runner, /greeting/);
  });

  it("documents pack acceptance for offline installs", async () => {
    const readme = await readFile(
      path.join(REPO_ROOT, "scripts", "acceptance", "m10-2e", "README.md"),
      "utf8",
    );
    assert.match(readme, /acceptance:m10-2e:pack/);
    assert.match(readme, /templates/);
  });

  it("CLI README covers deploy and PowerShell input guidance", async () => {
    const readme = await readFile(
      path.join(REPO_ROOT, "packages", "cli", "README.md"),
      "utf8",
    );
    for (const token of [
      "osva deploy",
      "osva run",
      "--input-file",
      "PowerShell",
      "OSVA_TRUSTED_RUNTIME_MODE",
    ]) {
      assert.match(
        readme,
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });
});
