import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("hello agent onboarding artifacts", () => {
  it("includes public example, golden-path script, and quickstart references", async () => {
    await access(
      path.join(
        REPO_ROOT,
        "examples",
        "hello-agent",
        "agent",
        "hello-agent.ts",
      ),
    );
    await access(
      path.join(
        REPO_ROOT,
        "examples",
        "hello-agent",
        "contracts",
        "input.v1.schema.json",
      ),
    );

    const rootPackage = JSON.parse(
      await readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    assert.equal(typeof rootPackage.scripts["example:hello"], "string");

    const quickstart = await readFile(
      path.join(REPO_ROOT, "docs", "OSS-COMMUNITY-QUICKSTART.md"),
      "utf8",
    );
    assert.match(quickstart, /hello-agent|example:hello/);

    const readme = await readFile(path.join(REPO_ROOT, "README.md"), "utf8");
    assert.match(readme, /example:hello|hello-agent/);
  });
});
