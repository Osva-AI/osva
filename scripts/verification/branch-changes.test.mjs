import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { branchChangedPaths } from "./branch-git.mjs";
import { runCommand } from "./environment.mjs";

/**
 * @param {string} cwd
 * @param {readonly string[]} args
 */
async function git(cwd, args) {
  const result = await runCommand("git", args, { cwd, stdio: "pipe" });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

describe("branch change discovery fixture", () => {
  it("includes modified, staged, untracked, rename, delete, and spaced paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-branch-"));
    try {
      await git(root, ["init"]);
      await git(root, ["config", "user.email", "test@example.com"]);
      await git(root, ["config", "user.name", "Test"]);
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      await fs.mkdir(path.join(root, "apps", "pkg"), { recursive: true });
      await fs.writeFile(
        path.join(root, "apps", "pkg", "keep.ts"),
        "export {};\n",
        "utf8",
      );
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "base"]);
      await git(root, ["branch", "-M", "main"]);
      await git(root, ["checkout", "-b", "feature"]);

      await fs.writeFile(
        path.join(root, "apps", "pkg", "keep.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "apps", "pkg", "staged only.ts"),
        "export {};\n",
        "utf8",
      );
      await git(root, ["add", "apps/pkg/staged only.ts"]);

      await fs.writeFile(
        path.join(root, "apps", "pkg", "untracked.ts"),
        "export {};\n",
        "utf8",
      );

      await fs.writeFile(
        path.join(root, "apps", "pkg", "old name.ts"),
        "export {};\n",
        "utf8",
      );
      await git(root, ["add", "apps/pkg/old name.ts"]);
      await git(root, ["commit", "-m", "add old"]);
      await fs.rename(
        path.join(root, "apps", "pkg", "old name.ts"),
        path.join(root, "apps", "pkg", "new name.ts"),
      );
      await git(root, ["add", "-A"]);

      await fs.writeFile(
        path.join(root, "apps", "pkg", "remove.ts"),
        "x\n",
        "utf8",
      );
      await git(root, ["add", "apps/pkg/remove.ts"]);
      await git(root, ["commit", "-m", "add remove"]);
      await fs.rm(path.join(root, "apps", "pkg", "remove.ts"));
      await git(root, ["add", "apps/pkg/remove.ts"]);

      const inventory = await branchChangedPaths({
        baseRef: "main",
        headRef: "feature",
        gitCwd: root,
      });
      assert.equal(inventory.ok, true);
      if (!inventory.ok) {
        return;
      }
      const paths = inventory.paths;
      assert.ok(paths.includes("apps/pkg/keep.ts"));
      assert.ok(paths.includes("apps/pkg/staged only.ts"));
      assert.ok(paths.includes("apps/pkg/untracked.ts"));
      assert.ok(
        paths.includes("apps/pkg/new name.ts") ||
          paths.includes("apps/pkg/old name.ts"),
      );
      assert.ok(paths.includes("apps/pkg/remove.ts"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
