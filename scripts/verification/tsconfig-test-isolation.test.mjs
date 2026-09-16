import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "./environment.mjs";

async function collectTestTsconfigs(root) {
  const found = [];

  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist"
      ) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "tsconfig.test.json") {
        found.push(fullPath);
      }
    }
  }

  await visit(root);
  return found;
}

describe("tsconfig.test.json isolation", () => {
  it("does not depend on a package's own dist declaration files", async () => {
    const configs = await collectTestTsconfigs(REPO_ROOT);
    assert.ok(
      configs.length > 0,
      "expected workspace tsconfig.test.json files",
    );
    for (const configPath of configs) {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const include = parsed.include ?? [];
      const paths = parsed.compilerOptions?.paths ?? {};
      const relative = path.relative(REPO_ROOT, configPath);
      assert.equal(
        include.some((pattern) => String(pattern).includes("dist")),
        false,
        `${relative} include must not reference dist`,
      );
      assert.equal(
        JSON.stringify(paths).includes("dist"),
        false,
        `${relative} paths must not reference dist`,
      );
      assert.match(
        raw,
        /"noEmit"\s*:\s*true/,
        `${relative} must typecheck tests with noEmit`,
      );
      assert.doesNotMatch(
        raw,
        /dist[\\/][^"\s]*\.d\.ts/,
        `${relative} must not require pre-built dist/*.d.ts`,
      );
    }
  });
});
