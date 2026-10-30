import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runPlatformCommand } from "../src/platform/index.js";
import { materializeInstallation } from "../src/setup/index.js";
import { loadComposeDistribution } from "../src/setup/distribution.js";
import { readSetupOptions } from "../src/setup/read-options.js";

const TEMP_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("platform upgrade", () => {
  it("dry-run reports plan without mutating installation", async () => {
    const installDir = await makeInstalledDir();
    const exitCode = await runPlatformCommand(
      ["upgrade"],
      {
        "install-dir": installDir,
        to: "1.1.0",
        "dry-run": true,
      },
      upgradeTestDeps(),
    );
    expect(exitCode).toBe(0);
  });

  it("refuses execution without backup attestation", async () => {
    const installDir = await makeInstalledDir();
    const exitCode = await runPlatformCommand(
      ["upgrade"],
      {
        "install-dir": installDir,
        to: "1.1.0",
        yes: true,
      },
      upgradeTestDeps(),
    );
    expect(exitCode).toBe(1);
  });
});

function upgradeTestDeps(): {
  fetch: typeof fetch;
  spawn: (
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ) => {
    status: number;
    stdout: string;
    stderr: string;
    error: undefined;
  };
} {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith("/health") || href.endsWith("/ready")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    return new Response("ok", { status: 200 });
  });
  return {
    fetch: fetchMock as typeof fetch,
    spawn: () => ({
      status: 0,
      stdout: "[]",
      stderr: "",
      error: undefined,
    }),
  };
}

async function makeInstalledDir(): Promise<string> {
  const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-upgrade-"));
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
    composeProjectName: string;
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
