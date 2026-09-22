#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleaseVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PYTHON_ROOT = path.join(REPO_ROOT, "sdks", "python");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PYTHON_ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: options.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}

function findWheel(distDir) {
  const files = fs.readdirSync(distDir).filter((name) => name.endsWith(".whl"));
  if (files.length !== 1) {
    throw new Error(
      `Expected one wheel in ${distDir}, found: ${files.join(", ")}`,
    );
  }
  return path.join(distDir, files[0]);
}

function main() {
  const version = readReleaseVersion();
  console.log(`python pack smoke (release ${version})`);

  run("python", ["-m", "pip", "install", "--upgrade", "pip", "build"], {
    stdio: "inherit",
  });
  run("python", ["-m", "build"], { stdio: "inherit" });

  const distDir = path.join(PYTHON_ROOT, "dist");
  const wheel = findWheel(distDir);
  const sdist = fs
    .readdirSync(distDir)
    .find((name) => name.endsWith(".tar.gz"));
  if (!sdist) {
    throw new Error("sdist tarball missing");
  }
  if (!wheel.includes(`-${version}-`)) {
    throw new Error(`Wheel file name does not include version ${version}`);
  }

  const venvDir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-py-venv-"));
  run("python", ["-m", "venv", venvDir], { cwd: REPO_ROOT });
  const python =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");

  run(python, ["-m", "pip", "install", "--upgrade", "pip"], {
    stdio: "inherit",
  });
  run(python, ["-m", "pip", "install", wheel], { stdio: "inherit" });
  run(
    python,
    [
      "-c",
      "from osva import OSVAClient; assert OSVAClient is not None; print('python import smoke ok')",
    ],
    { stdio: "inherit" },
  );

  console.log("python pack smoke PASS");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
