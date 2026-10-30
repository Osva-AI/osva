import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyServiceState,
  parseComposePsJson,
} from "../src/platform/compose-inspect.js";
import { resolveInstallationForLifecycle } from "../src/platform/resolve-installation.js";
import { runPlatformCommand } from "../src/platform/index.js";
import { deriveComposeProjectName } from "../src/setup/compose-project.js";
import { materializeInstallation } from "../src/setup/index.js";
import { loadComposeDistribution } from "../src/setup/distribution.js";
import { readSetupOptions } from "../src/setup/read-options.js";
import type { ProbeSpawnFn } from "../src/setup/probe-spawn.js";

const TEMP_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("platform lifecycle", () => {
  it("parses compose ps json and classifies health states", () => {
    const snapshots = parseComposePsJson(
      JSON.stringify([
        {
          Service: "web",
          Status: "Up 2 minutes (healthy)",
          Health: "healthy",
        },
        { Service: "worker", Status: "Exited (0) 1 hour ago" },
      ]),
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.state).toBe("healthy");
    expect(snapshots[1]?.state).toBe("stopped");
    expect(classifyServiceState("Up (unhealthy)", "unhealthy")).toBe(
      "unhealthy",
    );
  });

  it("refuses foreign install directories", async () => {
    const installDir = await makeTempDir("osva-platform-foreign-");
    await writeFile(path.join(installDir, "notes.txt"), "nope", "utf8");
    await expect(
      resolveInstallationForLifecycle(
        { "install-dir": installDir },
        {},
        "linux",
      ),
    ).rejects.toMatchObject({ code: "installation_invalid" });
  });

  it("resolves a materialized installation", async () => {
    const installDir = await makeInstalledDir();
    const resolved = await resolveInstallationForLifecycle(
      { "install-dir": installDir },
      {},
      "linux",
    );
    expect(resolved.execCtx.projectName).toBe(
      deriveComposeProjectName(installDir),
    );
    expect(resolved.webUrl).toBe("http://127.0.0.1:8080");
  });

  it("runs platform start with mocked compose and fetch", async () => {
    const installDir = await makeInstalledDir();
    const calls: string[] = [];
    const spawn: ProbeSpawnFn = (_executable, args) => {
      calls.push(args.join(" "));
      if (args.join(" ").includes(" ps ")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              Service: "migrate",
              Status: "Exited (0) 10 minutes ago",
            },
          ]),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    };
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/health") || href.endsWith("/ready")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (href.endsWith("/")) {
        return new Response("ok", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });

    const exitCode = await runPlatformCommand(
      ["start"],
      { "install-dir": installDir, json: true },
      { spawn, fetch: fetchMock as typeof fetch },
    );
    expect(exitCode).toBe(0);
    expect(
      calls.some((call) => call.includes("up") && call.includes("postgres")),
    ).toBe(true);
    expect(
      calls.some((call) => call.includes("--pull") && call.includes("never")),
    ).toBe(true);
    expect(calls.some((call) => call.includes("COMPOSE_PROJECT_NAME"))).toBe(
      false,
    );
    expect(
      calls.some(
        (call) => call.includes("--project-name") && call.includes("osva-"),
      ),
    ).toBe(true);
  });

  it("routes platform help without credentials", async () => {
    const exitCode = await runPlatformCommand(["help"], {});
    expect(exitCode).toBe(0);
  });
});

async function makeInstalledDir(): Promise<string> {
  const installDir = await makeTempDir("osva-platform-install-");
  const distribution = await loadComposeDistribution();
  const options = readSetupOptions({}, {}, "linux");
  await materializeInstallation({
    options: { ...options, installDir },
    distribution,
    processEnv: {},
  });
  const markerPath = path.join(installDir, ".osva", "installation.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
    installDir: string;
  };
  marker.installDir = installDir;
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return installDir;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}
