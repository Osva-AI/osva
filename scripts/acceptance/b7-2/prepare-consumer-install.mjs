#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONNECTOR_SDK_VERSION,
  GITHUB_CONNECTOR_PACKAGE,
  GITHUB_CONNECTOR_VERSION,
} from "./constants.mjs";
import {
  assertProvenance,
  readInstalledProvenance,
  registryPublishedVersion,
  resolvePublishedGithubStdioEntry,
} from "./lib/provenance.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ARTIFACT_DIR = path.join(REPO_ROOT, "artifacts/acceptance/b7-2");
const MANIFEST_PATH = path.join(ARTIFACT_DIR, "consumer-manifest.json");

async function main() {
  const registryVersion = registryPublishedVersion();
  if (registryVersion !== GITHUB_CONNECTOR_VERSION) {
    throw new Error(
      `npm registry version mismatch: expected ${GITHUB_CONNECTOR_VERSION}, got ${registryVersion ?? "unknown"}`,
    );
  }

  const parent = await mkdtemp(path.join(os.tmpdir(), "osva-b7-2-consumer-"));
  const installRoot = path.join(parent, "npm");
  await mkdir(installRoot, { recursive: true });

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  spawnSync(npmCmd, ["init", "-y"], {
    cwd: installRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const consumerPkg = JSON.parse(
    await readFile(path.join(installRoot, "package.json"), "utf8"),
  );
  consumerPkg.type = "module";
  consumerPkg.engines = { node: ">=24" };
  await writeFile(
    path.join(installRoot, "package.json"),
    `${JSON.stringify(consumerPkg, null, 2)}\n`,
  );

  const install = spawnSync(
    npmCmd,
    [
      "install",
      `${GITHUB_CONNECTOR_PACKAGE}@${GITHUB_CONNECTOR_VERSION}`,
      `@osva-ai/connector-sdk@${CONNECTOR_SDK_VERSION}`,
      "--no-fund",
      "--no-audit",
      "--save-exact",
    ],
    {
      cwd: installRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: 600_000,
    },
  );
  if (install.status !== 0) {
    await rm(parent, { recursive: true, force: true });
    process.exit(install.status ?? 1);
  }

  const provenance = readInstalledProvenance(installRoot);
  assertProvenance(provenance);
  const stdioEntry = resolvePublishedGithubStdioEntry(installRoot);

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const manifest = {
    schemaVersion: "1",
    preparedAt: new Date().toISOString(),
    installRoot,
    consumerWorkRoot: parent,
    stdioEntry,
    provenance,
    credential: {
      secretReferenceKey: "B7_2_GITHUB_OPERATOR_PAT",
      note: "Operator sets env; never store token in this manifest.",
    },
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${MANIFEST_PATH}`);
  console.log(`stdioEntry=${stdioEntry}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
