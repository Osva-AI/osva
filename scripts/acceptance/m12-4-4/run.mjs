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

const M1243_RUNNER = path.join(
  REPO_ROOT,
  "scripts",
  "acceptance",
  "m12-4-3",
  "run.mjs",
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
  const packDir = await mkdtemp(path.join(os.tmpdir(), "osva-m1244-pack-"));
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

async function externalPackagedRuntimeSmoke() {
  const workRoot = await mkdtemp(
    path.join(os.tmpdir(), "osva-m1244-external-runtime-"),
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
    fixturePackage.scripts = {
      ...fixturePackage.scripts,
      build: "tsc -p tsconfig.build.json",
    };
    await writeFile(
      path.join(installRoot, "package.json"),
      `${JSON.stringify(fixturePackage, null, 2)}\n`,
    );

    const { cp } = await import("node:fs/promises");
    await cp(path.join(FIXTURE_ROOT, "src"), path.join(installRoot, "src"), {
      recursive: true,
    });
    await cp(
      path.join(FIXTURE_ROOT, "tsconfig.json"),
      path.join(installRoot, "tsconfig.json"),
    );
    await cp(
      path.join(FIXTURE_ROOT, "tsconfig.build.json"),
      path.join(installRoot, "tsconfig.build.json"),
    );
    await cp(
      path.join(FIXTURE_ROOT, "scripts", "runtime-smoke.mjs"),
      path.join(installRoot, "scripts", "runtime-smoke.mjs"),
    );

    run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: installRoot,
      shell: true,
    });
    run("npm", ["run", "typecheck"], { cwd: installRoot, shell: true });
    run("npm", ["run", "build"], { cwd: installRoot, shell: true });
    run("node", ["scripts/runtime-smoke.mjs"], { cwd: installRoot });
  } finally {
    await rm(workRoot, { force: true, recursive: true });
    if (packDir !== undefined) {
      await rm(packDir, { force: true, recursive: true });
    }
  }
}

async function main() {
  run("node", [M1243_RUNNER]);
  run("pnpm", [
    "exec",
    "turbo",
    "run",
    "test",
    "--filter=@osva/adapters-artifact-storage",
  ]);
  await externalPackagedRuntimeSmoke();
  console.log("M12.4.4 ecosystem closeout acceptance passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
