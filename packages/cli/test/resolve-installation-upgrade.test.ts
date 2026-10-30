import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveInstallationForLifecycle } from "../src/platform/resolve-installation.js";
import { materializeInstallation } from "../src/setup/index.js";
import { loadComposeDistribution } from "../src/setup/distribution.js";
import { readSetupOptions } from "../src/setup/read-options.js";
import { writeUpgradeState } from "../src/platform/upgrade/state.js";

const TEMP_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveInstallationForLifecycle during upgrade", () => {
  it("allows image drift between marker and env when upgrade state is incomplete", async () => {
    const installDir = await makeInstalledDir();
    const envPath = path.join(installDir, ".env");
    const envRaw = await readFile(envPath, "utf8");
    await writeFile(
      envPath,
      envRaw.replace(/OSVA_IMAGE=.*/, "OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0"),
    );
    await writeUpgradeState(installDir, {
      schemaVersion: 1,
      phase: "failed",
      fromPlatformVersion: "1.1.0-rc.4",
      toPlatformVersion: "1.1.0",
      fromImageRef: "ghcr.io/osva-ai/osva:1.1.0-rc.4",
      targetImageRef: "ghcr.io/osva-ai/osva:1.1.0",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      migrationRequired: true,
      lastError: "readiness check failed",
    });
    const resolved = await resolveInstallationForLifecycle(
      { "install-dir": installDir },
      {},
      "linux",
    );
    expect(resolved.envValues.OSVA_IMAGE).toBe("ghcr.io/osva-ai/osva:1.1.0");
    expect(resolved.marker.imageRef).toBe("ghcr.io/osva-ai/osva:1.1.0-rc.4");
  });
});

async function makeInstalledDir(): Promise<string> {
  const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-resolve-upg-"));
  TEMP_DIRS.push(installDir);
  const distribution = await loadComposeDistribution();
  const options = readSetupOptions({}, {}, "linux");
  await materializeInstallation({
    options: { ...options, installDir },
    distribution,
    processEnv: {},
  });
  const markerPath = path.join(installDir, ".osva", "installation.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
    platformVersion: string;
    imageRef: string;
    installDir: string;
  };
  marker.platformVersion = "1.1.0-rc.4";
  marker.imageRef = "ghcr.io/osva-ai/osva:1.1.0-rc.4";
  marker.installDir = installDir;
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  const envPath = path.join(installDir, ".env");
  const envRaw = await readFile(envPath, "utf8");
  await writeFile(
    envPath,
    envRaw.replace(
      /OSVA_IMAGE=.*/,
      "OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4",
    ),
    "utf8",
  );
  return installDir;
}
