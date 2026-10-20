#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const FIXTURE_ROOT = path.join(
  REPO_ROOT,
  "test-fixtures",
  "artifact-blob-store-external-consumer",
);

function run(command, args, options = {}) {
  const useShell =
    options.shell ??
    (process.platform === "win32" &&
      (command === "pnpm" || command === "npm" || command === "npx"));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: options.stdio ?? "inherit",
    shell: useShell,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${String(result.status)})`,
    );
  }
}

async function packContracts() {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "osva-m1243-pack-"));
  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@osva-ai/contracts"]);
  run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: path.join(REPO_ROOT, "packages", "contracts"),
  });
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(packDir)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected one contracts tarball, found ${files.join(", ")}`,
    );
  }
  return { tgz: path.join(packDir, files[0]), packDir };
}

async function main() {
  const workRoot = await mkdtemp(
    path.join(os.tmpdir(), "osva-m1243-consumer-"),
  );
  const installRoot = path.join(workRoot, "consumer");
  let packDir;

  try {
    const packed = await packContracts();
    packDir = packed.packDir;
    await mkdir(installRoot, { recursive: true });

    const fixturePackage = JSON.parse(
      await readFile(path.join(FIXTURE_ROOT, "package.json"), "utf8"),
    );
    fixturePackage.dependencies["@osva-ai/contracts"] = packed.tgz;
    await writeFile(
      path.join(installRoot, "package.json"),
      `${JSON.stringify(fixturePackage, null, 2)}\n`,
    );
    await mkdir(path.join(installRoot, "src"), { recursive: true });
    const { cp } = await import("node:fs/promises");
    await cp(path.join(FIXTURE_ROOT, "src"), path.join(installRoot, "src"), {
      recursive: true,
    });
    await cp(
      path.join(FIXTURE_ROOT, "tsconfig.json"),
      path.join(installRoot, "tsconfig.json"),
    );

    run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: installRoot,
      shell: true,
    });
    run("npm", ["run", "typecheck"], { cwd: installRoot, shell: true });

    run("pnpm", [
      "exec",
      "turbo",
      "run",
      "build",
      "test",
      "--filter=@osva/adapters-artifact-storage",
    ]);

    console.log(
      "M12.4.3 artifact adapter external consumer acceptance passed.",
    );
  } finally {
    await rm(workRoot, { force: true, recursive: true });
    if (packDir !== undefined) {
      await rm(packDir, { force: true, recursive: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
