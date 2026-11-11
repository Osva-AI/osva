import { describe, expect, it } from "vitest";

import {
  mergePersistedInstallationPorts,
  readExplicitPublishPortFlags,
  resolveAutoPublishPorts,
} from "../src/setup/resolve-publish-ports.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("resolve publish ports", () => {
  it("detects explicit CLI port flags", () => {
    expect(
      readExplicitPublishPortFlags({ "web-port": "9090" }, {}),
    ).toMatchObject({ web: true, mcp: false });
  });

  it("loads persisted ports for existing installation", async () => {
    const installDir = await mkEmptyInstall();
    await writeFile(
      path.join(installDir, ".env"),
      [
        "COMPOSE_PROJECT_NAME=osva-test",
        "OSVA_IMAGE=ghcr.io/example/osva:dev",
        "POSTGRES_PASSWORD=01234567890123456789012345678901",
        "OSVA_AUTH_SECRET=01234567890123456789012345678901",
        "OSVA_PUBLISH_WEB_PORT=48100",
        "OSVA_PUBLISH_MCP_PORT=43100",
        "OSVA_PUBLISH_CONSOLE_PORT=44174",
        "OSVA_AUTH_BASE_URL=http://127.0.0.1:48100",
        "OSVA_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:48100,http://127.0.0.1:44174",
        "OSVA_VALKEY_URL=redis://valkey:6379",
      ].join("\n"),
    );
    await writeFile(
      path.join(installDir, ".osva", "installation.json"),
      JSON.stringify({
        schemaVersion: 1,
        platformVersion: "test",
        imageRef: "ghcr.io/example/osva:dev",
        cliVersion: "0.0.0",
        installDir,
        composeProjectName: "osva-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const base = {
      webPort: 8080,
      mcpPort: 3100,
      consolePort: 4174,
      runtimeCapabilityPort: 8787,
      remoteHttpDev: false,
      installDir,
      preflightOnly: false,
      authorizeExisting: false,
      adminEmail: "",
      adminName: "Owner",
      organizationName: "Org",
      workspaceName: "Workspace",
      createBootstrapAdminApiKey: false,
      autoPorts: false,
    };
    const merged = await mergePersistedInstallationPorts(base, {
      web: false,
      mcp: false,
      console: false,
      runtime: false,
    });
    expect(merged.webPort).toBe(48100);
    expect(merged.consolePort).toBe(44174);
    await rm(installDir, { recursive: true, force: true });
  });

  it("auto-selects alternates without touching explicit ports", async () => {
    const inUse = new Set([8080, 3100]);
    const probe = async (port: number) =>
      inUse.has(port)
        ? ({ kind: "in_use" } as const)
        : ({ kind: "available" } as const);
    const resolved = await resolveAutoPublishPorts({
      options: {
        webPort: 8080,
        mcpPort: 3200,
        consolePort: 4174,
        runtimeCapabilityPort: 8787,
        remoteHttpDev: false,
        installDir: os.tmpdir(),
        preflightOnly: false,
        authorizeExisting: false,
        adminEmail: "",
        adminName: "Owner",
        organizationName: "Org",
        workspaceName: "Workspace",
        createBootstrapAdminApiKey: false,
        autoPorts: true,
      },
      explicit: {
        web: false,
        mcp: true,
        console: false,
        runtime: false,
      },
      probe,
      autoPorts: true,
    });
    expect(resolved.options.webPort).toBe(8081);
    expect(resolved.options.mcpPort).toBe(3200);
  });
});

async function mkEmptyInstall(): Promise<string> {
  const installDir = path.join(
    os.tmpdir(),
    `osva-port-test-${String(Date.now())}`,
  );
  await mkdir(path.join(installDir, ".osva"), { recursive: true });
  return installDir;
}
