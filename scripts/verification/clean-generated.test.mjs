import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { cleanGenerated } from "./clean-generated.mjs";

async function writeFile(root, relative, contents) {
  const fullPath = path.join(root, relative);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, contents, "utf8");
}

describe("cleanGenerated", () => {
  it("removes known generated files and preserves source and unknown files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-clean-"));
    try {
      await writeFile(root, "src/index.ts", "export const value = 1;\n");
      await writeFile(root, "packages/cli/src/main.ts", "export {};\n");
      await writeFile(root, "notes.txt", "keep me\n");
      await writeFile(root, "dist/index.js", "generated\n");
      await writeFile(root, "packages/cli/dist/index.d.ts", "generated\n");
      await writeFile(root, "packages/cli/dist/tsconfig.tsbuildinfo", "{}\n");
      await writeFile(root, "coverage/lcov.info", "generated\n");
      await writeFile(root, ".turbo/cache.json", "{}\n");
      await writeFile(root, "sdks/python/src/osva/__init__.py", "# source\n");
      await writeFile(root, "sdks/python/dist/pkg.whl", "generated\n");
      await writeFile(
        root,
        "sdks/python/build/lib/osva/__init__.py",
        "generated\n",
      );
      await writeFile(
        root,
        "sdks/python/src/osva_sdk.egg-info/PKG-INFO",
        "generated\n",
      );
      await writeFile(
        root,
        "sdks/python/__pycache__/mod.cpython-311.pyc",
        "generated\n",
      );
      await writeFile(root, ".pytest_cache/v/cache", "generated\n");
      await writeFile(root, "node_modules/pkg/dist/index.js", "must survive\n");
      await writeFile(root, ".git/config", "must survive\n");
      await writeFile(root, "fixtures/sample.json", '{"ok":true}\n');

      const removed = await cleanGenerated(root);
      const remaining = async (relative) => {
        try {
          await fs.access(path.join(root, relative));
          return true;
        } catch {
          return false;
        }
      };

      assert.equal(await remaining("src/index.ts"), true);
      assert.equal(await remaining("packages/cli/src/main.ts"), true);
      assert.equal(await remaining("notes.txt"), true);
      assert.equal(await remaining("sdks/python/src/osva/__init__.py"), true);
      assert.equal(await remaining("node_modules/pkg/dist/index.js"), true);
      assert.equal(await remaining(".git/config"), true);
      assert.equal(await remaining("fixtures/sample.json"), true);

      assert.equal(await remaining("dist/index.js"), false);
      assert.equal(await remaining("packages/cli/dist/index.d.ts"), false);
      assert.equal(await remaining("coverage/lcov.info"), false);
      assert.equal(await remaining(".turbo/cache.json"), false);
      assert.equal(await remaining("sdks/python/dist/pkg.whl"), false);
      assert.equal(
        await remaining("sdks/python/build/lib/osva/__init__.py"),
        false,
      );
      assert.equal(
        await remaining("sdks/python/src/osva_sdk.egg-info/PKG-INFO"),
        false,
      );
      assert.equal(
        await remaining("sdks/python/__pycache__/mod.cpython-311.pyc"),
        false,
      );
      assert.equal(await remaining(".pytest_cache/v/cache"), false);

      assert.ok(
        removed.some(
          (item) =>
            item === "dist" ||
            item.endsWith(`${path.sep}dist`) ||
            item === path.join("packages", "cli", "dist") ||
            item.replaceAll("\\", "/").includes("dist"),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("dry-run does not delete files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-clean-dry-"));
    try {
      await writeFile(root, "src/keep.ts", "export {};\n");
      await writeFile(root, "dist/gone.js", "generated\n");
      const wouldRemove = await cleanGenerated(root, { dryRun: true });
      await fs.access(path.join(root, "dist/gone.js"));
      await fs.access(path.join(root, "src/keep.ts"));
      assert.ok(
        wouldRemove.some((item) => item === "dist" || item.endsWith("dist")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
