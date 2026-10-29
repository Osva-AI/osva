import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RC4_SEMVER } from "../constants.mjs";

/**
 * @returns {Promise<{ installRoot: string, dispose: () => Promise<void> }>}
 */
export async function createPublishedNpmConsumer() {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "osva-r11-consumer-"));
  const installRoot = path.join(workRoot, "npm");
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
  await writeFile(
    path.join(installRoot, "package.json"),
    `${JSON.stringify(consumerPkg, null, 2)}\n`,
  );

  const install = spawnSync(
    npmCmd,
    [
      "install",
      `@osva-ai/cli@${RC4_SEMVER}`,
      `@osva-ai/sdk@${RC4_SEMVER}`,
      "--no-fund",
      "--no-audit",
    ],
    {
      cwd: installRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: 300_000,
    },
  );
  if (install.status !== 0) {
    await rm(workRoot, { recursive: true, force: true });
    throw new Error("npm install published CLI/SDK failed");
  }

  return {
    installRoot,
    workRoot,
    dispose: () => rm(workRoot, { recursive: true, force: true }),
  };
}
