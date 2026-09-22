#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_NPM_PACKAGES, readReleaseVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const PACK_ORDER = [
  "@osva/contracts",
  "@osva/runtime-protocol",
  "@osva/sdk",
  "@osva/connector-sdk",
  "@osva/cli",
];

function run(command, args, options = {}) {
  const useShell =
    options.shell ??
    (process.platform === "win32" &&
      (command === "pnpm" || command === "npm" || command === "turbo"));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? "pipe",
    shell: useShell,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}

function main() {
  const version = readReleaseVersion();
  console.log(`npm pack smoke (release ${version})`);

  run(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@osva/contracts",
      "--filter=@osva/runtime-protocol",
      "--filter=@osva/sdk",
      "--filter=@osva/connector-sdk",
      "--filter=@osva/cli",
    ],
    { stdio: "inherit" },
  );

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-npm-pack-"));
  const tarballs = new Map();

  for (const name of PACK_ORDER) {
    const dir = name.replace("@osva/", "");
    const stdout = run("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: path.join(REPO_ROOT, "packages", dir),
    });
    const tarballLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(".tgz"));
    if (!tarballLine) {
      throw new Error(`pnpm pack did not report tarball for ${name}`);
    }
    const tarballPath = path.isAbsolute(tarballLine)
      ? tarballLine
      : path.join(packDir, path.basename(tarballLine));
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball missing for ${name}: ${tarballPath}`);
    }
    tarballs.set(name, tarballPath);
    const dry = run("npm", ["pack", "--dry-run"], {
      cwd: path.join(REPO_ROOT, "packages", dir),
    });
    if (dry.includes("node_modules/typescript")) {
      throw new Error(`${name} pack dry-run includes dev tooling`);
    }
    console.log(`packed ${name} -> ${path.basename(tarballPath)}`);
  }

  const consumerDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "osva-npm-consumer-"),
  );
  const packageJson = {
    name: "osva-npm-consumer-smoke",
    private: true,
    type: "module",
    dependencies: {},
  };
  for (const [name, tarball] of tarballs) {
    packageJson.dependencies[name] = `file:${tarball.replace(/\\/g, "/")}`;
  }
  fs.writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  run("npm", ["install", "--omit=dev"], { cwd: consumerDir, stdio: "inherit" });

  const importCheck = `
import { OsvaClient } from "@osva/sdk";
import "@osva/contracts";
import "@osva/runtime-protocol";
import "@osva/connector-sdk";
if (!(OsvaClient.prototype && typeof OsvaClient === "function")) {
  throw new Error("OsvaClient export missing");
}
console.log("npm consumer import smoke ok");
`;
  fs.writeFileSync(
    path.join(consumerDir, "import-smoke.mjs"),
    importCheck,
    "utf8",
  );
  run(process.execPath, ["import-smoke.mjs"], {
    cwd: consumerDir,
    stdio: "inherit",
  });

  const cliBin = path.join(
    consumerDir,
    "node_modules",
    "@osva",
    "cli",
    "dist",
    "bin",
    "osva.js",
  );
  if (!fs.existsSync(cliBin)) {
    throw new Error("CLI bin missing from consumer install");
  }
  const help = run(process.execPath, [cliBin, "help"], { cwd: consumerDir });
  if (!help.includes("Usage:")) {
    throw new Error("CLI help did not render from packed install");
  }
  const versionOut = run(process.execPath, [cliBin, "version"], {
    cwd: consumerDir,
  });
  if (!versionOut.includes(version)) {
    throw new Error(`CLI version expected ${version}, got: ${versionOut}`);
  }

  console.log("npm pack smoke PASS");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
