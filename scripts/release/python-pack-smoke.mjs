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

/** Hatchling wheel filenames use PEP 440 (for example 1.1.0-rc.1 → 1.1.0rc1). */
function pep440ArtifactVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)-([a-zA-Z]+)\.(\d+)$/);
  if (match) {
    const [, base, label, num] = match;
    return `${base}${label}${num}`;
  }
  return version;
}

function cleanDist(distDir) {
  if (!fs.existsSync(distDir)) {
    return;
  }
  for (const name of fs.readdirSync(distDir)) {
    if (name.endsWith(".whl") || name.endsWith(".tar.gz")) {
      fs.unlinkSync(path.join(distDir, name));
    }
  }
}

function findWheel(distDir, version) {
  const artifactVersion = pep440ArtifactVersion(version);
  const files = fs
    .readdirSync(distDir)
    .filter(
      (name) => name.endsWith(".whl") && name.includes(`-${artifactVersion}-`),
    );
  if (files.length !== 1) {
    const all = fs.readdirSync(distDir).filter((name) => name.endsWith(".whl"));
    throw new Error(
      `Expected one wheel for ${artifactVersion} in ${distDir}, found: ${all.join(", ")}`,
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
  const distDir = path.join(PYTHON_ROOT, "dist");
  cleanDist(distDir);
  run("python", ["-m", "build"], { stdio: "inherit" });

  const artifactVersion = pep440ArtifactVersion(version);
  const wheel = findWheel(distDir, version);
  const sdist = fs
    .readdirSync(distDir)
    .find(
      (name) =>
        name.endsWith(".tar.gz") && name.includes(`-${artifactVersion}`),
    );
  if (!sdist) {
    throw new Error(`sdist tarball missing for version ${artifactVersion}`);
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
      `from importlib.metadata import version as pkg_version; from osva import OSVAClient; assert OSVAClient is not None; installed = pkg_version("osva-sdk"); expected = ${JSON.stringify(version)}; allowed = {expected, expected.replace("-rc.", "rc")}; assert installed in allowed, f"unexpected installed version {installed} (expected one of {sorted(allowed)})"; print(f"python import smoke ok ({installed})")`,
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
