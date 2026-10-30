import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "./npm-command.mjs";
import { assertPublishablePackedManifest } from "./npm-packed-manifest.mjs";
import { NPM_PUBLIC_PACK_ORDER } from "./npm-public-packages.mjs";

/**
 * Install packed tarballs with npm in dependency order, using overrides so
 * @osva-ai/* semver edges resolve to local tarballs (not the public registry).
 *
 * @param {Map<string, { tarballPath: string }>} artifacts
 * @param {string} version
 */
export function runIsolatedNpmConsumerSmoke(artifacts, version) {
  const consumerDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "osva-npm-consumer-"),
  );

  /** @type {Record<string, string>} */
  const overrides = {};
  /** @type {Record<string, string>} */
  const dependencies = {};

  for (const name of NPM_PUBLIC_PACK_ORDER) {
    const entry = artifacts.get(name);
    if (!entry) {
      throw new Error(`Missing artifact for ${name}`);
    }
    const fileSpec = `file:${entry.tarballPath.replace(/\\/g, "/")}`;
    overrides[name] = fileSpec;
    dependencies[name] = fileSpec;

    const packageJson = {
      name: "osva-npm-consumer-smoke",
      private: true,
      type: "module",
      dependencies: { ...dependencies },
      overrides: { ...overrides },
    };
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8",
    );

    runCommand("npm", ["install", "--omit=dev"], {
      cwd: consumerDir,
      stdio: "inherit",
    });

    const installedRoot = path.join(
      consumerDir,
      "node_modules",
      ...name.split("/"),
    );
    const installedManifest = JSON.parse(
      fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"),
    );
    assertPublishablePackedManifest(installedManifest, {
      expectedName: name,
      expectedVersion: version,
      contextLabel: `${name} (installed from tarball)`,
    });
  }

  const importCheck = `
import { OsvaClient } from "@osva-ai/sdk";
import "@osva-ai/contracts";
import "@osva-ai/runtime-protocol";
import "@osva-ai/connector-sdk";
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
  runCommand(process.execPath, ["import-smoke.mjs"], {
    cwd: consumerDir,
    stdio: "inherit",
  });

  const cliBin = path.join(
    consumerDir,
    "node_modules",
    "@osva-ai",
    "cli",
    "dist",
    "bin",
    "osva.js",
  );
  if (!fs.existsSync(cliBin)) {
    throw new Error("CLI bin missing from consumer install");
  }
  const help = runCommand(process.execPath, [cliBin, "help"], {
    cwd: consumerDir,
  });
  if (!help.includes("Usage:")) {
    throw new Error("CLI help did not render from packed install");
  }
  const versionOut = runCommand(process.execPath, [cliBin, "version"], {
    cwd: consumerDir,
  });
  if (!versionOut.includes(version)) {
    throw new Error(`CLI version expected ${version}, got: ${versionOut}`);
  }

  const cliRoot = path.join(consumerDir, "node_modules", "@osva-ai", "cli");
  const templateRoot = path.join(
    cliRoot,
    "templates",
    "agent-typescript",
    "scripts",
    "build-manifest.mjs",
  );
  if (!fs.existsSync(templateRoot)) {
    throw new Error("CLI consumer install missing bundled templates");
  }
  const installedCliPkg = JSON.parse(
    fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
  );
  if (!installedCliPkg.dependencies?.ajv) {
    throw new Error("Installed CLI package.json missing ajv dependency");
  }

  return { consumerDir, help };
}
