import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { committedBranchChangedPaths } from "./committed-branch-paths.mjs";
import { runCommand } from "./environment.mjs";

async function git(cwd, args) {
  const result = await runCommand("git", args, { cwd, stdio: "pipe" });
  if (result.code !== 0) {
    throw new Error(`git failed: ${result.stderr}`);
  }
  return result.stdout;
}

describe("pre-push verify committed paths", () => {
  it("includes files from multiple commits since merge-base", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-pre-push-"));
    try {
      await git(root, ["init"]);
      await git(root, ["config", "user.email", "test@example.com"]);
      await git(root, ["config", "user.name", "Test"]);
      await fs.mkdir(path.join(root, "apps"), { recursive: true });
      await fs.writeFile(
        path.join(root, "apps", "a.ts"),
        "export const a=1;\n",
        "utf8",
      );
      await git(root, ["add", "apps/a.ts"]);
      await git(root, ["commit", "-m", "base"]);
      await git(root, ["branch", "-M", "main"]);
      await git(root, ["checkout", "-b", "feature"]);

      await fs.writeFile(path.join(root, "apps", "old.ts"), "x\n", "utf8");
      await git(root, ["add", "apps/old.ts"]);
      await git(root, ["commit", "-m", "commit1"]);

      await fs.writeFile(
        path.join(root, "apps", "b.ts"),
        "export const b=2;\n",
        "utf8",
      );
      await git(root, ["add", "apps/b.ts"]);
      await git(root, ["commit", "-m", "commit2"]);

      const inv = await committedBranchChangedPaths({
        baseRef: "main",
        headRef: "feature",
        gitCwd: root,
      });
      assert.equal(inv.ok, true);
      if (!inv.ok) {
        return;
      }
      // merge-base..HEAD lists paths that differ from the common ancestor, not every
      // file ever touched on main before the branch point.
      assert.ok(!inv.paths.includes("apps/a.ts"));
      assert.ok(inv.paths.includes("apps/old.ts"));
      assert.ok(inv.paths.includes("apps/b.ts"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when base ref is missing", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-pre-push-base-"),
    );
    try {
      await git(root, ["init"]);
      await git(root, ["config", "user.email", "test@example.com"]);
      await git(root, ["config", "user.name", "Test"]);
      await fs.writeFile(path.join(root, "README.md"), "x\n", "utf8");
      await git(root, ["add", "README.md"]);
      await git(root, ["commit", "-m", "init"]);
      const inv = await committedBranchChangedPaths({
        baseRef: "refs/heads/__osva_missing_base_for_pre_push__",
        headRef: "HEAD",
        gitCwd: root,
      });
      assert.equal(inv.ok, false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
