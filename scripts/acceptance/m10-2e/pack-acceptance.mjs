#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${String(result.status)})`,
    );
  }
}

async function packPackage(filter) {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "osva-pack-"));
  run("pnpm", ["exec", "turbo", "run", "build", `--filter=${filter}...`]);
  run("pnpm", ["--filter", filter, "pack", "--pack-destination", packDir]);
  const files = (await readdir(packDir)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected one tarball for ${filter}, found ${files.join(", ")}`,
    );
  }
  return { tgz: path.join(packDir, files[0]), packDir };
}

async function main() {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "osva-m102e-pack-"));
  const installRoot = path.join(workRoot, "install");
  const packDirs = [];

  try {
    await mkdir(installRoot, { recursive: true });

    const contracts = await packPackage("@osva-ai/contracts");
    packDirs.push(contracts.packDir);
    const runtimeProtocol = await packPackage("@osva-ai/runtime-protocol");
    packDirs.push(runtimeProtocol.packDir);
    const sdk = await packPackage("@osva-ai/sdk");
    packDirs.push(sdk.packDir);
    const cli = await packPackage("@osva-ai/cli");
    packDirs.push(cli.packDir);

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    run(npmCmd, ["init", "-y"], { cwd: installRoot });
    run(
      npmCmd,
      [
        "install",
        contracts.tgz,
        runtimeProtocol.tgz,
        sdk.tgz,
        cli.tgz,
        "--no-fund",
        "--no-audit",
      ],
      { cwd: installRoot },
    );

    const cliBin = path.join(
      installRoot,
      "node_modules",
      "@osva-ai",
      "cli",
      "dist",
      "bin",
      "osva.js",
    );
    await stat(cliBin);

    const templateRoot = path.join(
      installRoot,
      "node_modules",
      "@osva-ai",
      "cli",
      "templates",
      "agent-typescript",
    );
    await stat(path.join(templateRoot, "scripts", "build-manifest.mjs"));
    await stat(path.join(templateRoot, "contracts", "input.v1.schema.json"));

    const projectParent = path.join(workRoot, "projects");
    await mkdir(projectParent, { recursive: true });

    const init = spawnSync(
      process.execPath,
      [cliBin, "init", "packed-agent", "--yes"],
      {
        cwd: projectParent,
        encoding: "utf8",
        env: { ...process.env, OSVA_API_KEY: "", OSVA_BASE_URL: "" },
      },
    );
    if (init.status !== 0) {
      throw new Error(`osva init failed: ${init.stderr}`);
    }

    const projectDir = path.join(projectParent, "packed-agent");
    run(npmCmd, ["install", "--no-fund", "--no-audit"], { cwd: projectDir });
    run(npmCmd, ["run", "build"], { cwd: projectDir });
    run(npmCmd, ["run", "manifest"], { cwd: projectDir });

    const validate = spawnSync(
      process.execPath,
      [cliBin, "validate", "--json"],
      {
        cwd: projectDir,
        encoding: "utf8",
        env: { ...process.env, OSVA_API_KEY: "", OSVA_BASE_URL: "" },
      },
    );
    if (validate.status !== 0) {
      throw new Error(
        `osva validate failed: ${validate.stderr}\n${validate.stdout}`,
      );
    }
    const report = JSON.parse(validate.stdout);
    if (report.result !== "pass") {
      throw new Error(`validate result=${report.result}`);
    }

    console.log(
      JSON.stringify(
        {
          acceptance: "m10-2e-pack",
          ok: true,
          installRoot,
          projectDir,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(workRoot, { recursive: true, force: true });
    await Promise.all(
      packDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
