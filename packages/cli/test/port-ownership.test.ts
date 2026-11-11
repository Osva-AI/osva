import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assessLoopbackPortOwnership,
  extractLoopbackHostPorts,
  parseComposePsPublishers,
  parseDockerNetworkSettingsPorts,
} from "../src/setup/port-ownership.js";
import type { ProbeSpawnFn } from "../src/setup/probe-spawn.js";
import * as composeExec from "../src/setup/compose-exec.js";

describe("compose port ownership parsing", () => {
  it("extracts loopback host ports from publisher strings", () => {
    expect(
      extractLoopbackHostPorts(
        "127.0.0.1:8080->8080/tcp,127.0.0.1:3100->3100/tcp",
      ),
    ).toEqual([8080, 3100]);
    expect(extractLoopbackHostPorts("0.0.0.0:57221->8080/tcp")).toEqual([
      57221,
    ]);
    expect(
      extractLoopbackHostPorts("localhost:4010->4010/tcp,::1:4020->4020/tcp"),
    ).toEqual([4010, 4020]);
  });

  it("classifies publishers for this installation project", () => {
    const publishers = parseComposePsPublishers(
      JSON.stringify([
        {
          Service: "web",
          Project: "osva-abc",
          Publishers: "127.0.0.1:18080->8080/tcp",
        },
        {
          Service: "web",
          Project: "osva-other",
          Publishers: "127.0.0.1:8080->8080/tcp",
        },
      ]),
      "osva-abc",
    );
    expect(publishers).toHaveLength(2);
    expect(publishers[0]?.hostPort).toBe(18080);
    expect(publishers[0]?.projectName).toBe("osva-abc");
  });
});

describe("docker inspect port bindings", () => {
  it("parses loopback bindings from NetworkSettings.Ports JSON", () => {
    const portsJson = JSON.stringify({
      "8080/tcp": [
        { HostIp: "127.0.0.1", HostPort: "51474" },
        { HostIp: "192.168.1.2", HostPort: "51474" },
      ],
      "3100/tcp": [{ HostIp: "0.0.0.0", HostPort: "51475" }],
    });
    expect(parseDockerNetworkSettingsPorts(portsJson)).toEqual([51474, 51475]);
  });

  it("returns empty for null or invalid inspect output", () => {
    expect(parseDockerNetworkSettingsPorts("null")).toEqual([]);
    expect(parseDockerNetworkSettingsPorts("")).toEqual([]);
    expect(parseDockerNetworkSettingsPorts("not-json")).toEqual([]);
  });
});

function testInstallationMarker(
  installDir: string,
  composeProjectName: string,
): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    schemaVersion: 1,
    platformVersion: "test",
    imageRef: "osva/local:test",
    cliVersion: "0.0.0-test",
    installDir,
    composeProjectName,
    createdAt: now,
    updatedAt: now,
  });
}

describe("assessLoopbackPortOwnership docker evidence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unknown when .env matches but inspect cannot verify binding", async () => {
    const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-port-own-"));
    await writeFile(
      path.join(installDir, ".env"),
      "OSVA_PUBLISH_WEB_PORT=18080\n",
      "utf8",
    );
    await mkdir(path.join(installDir, ".osva"), { recursive: true });
    await writeFile(
      path.join(installDir, ".osva", "installation.json"),
      testInstallationMarker(installDir, "osva-test"),
      "utf8",
    );

    const composeSpy = vi.spyOn(composeExec, "runComposeCommand");
    composeSpy.mockImplementation((_ctx, args) => {
      if (args[0] === "ps" && args.includes("json")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              ID: "abc123container",
              Service: "web",
              Project: "osva-test",
            },
          ]),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    });

    const spawn: ProbeSpawnFn = (command, args) => {
      if (command === "docker" && args[0] === "inspect") {
        return {
          status: 0,
          stdout: JSON.stringify({ "8080/tcp": [] }),
          stderr: "",
          error: undefined,
        };
      }
      if (command === "docker" && args[0] === "ps") {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      return { status: 1, stdout: "", stderr: "", error: undefined };
    };

    const result = await assessLoopbackPortOwnership({
      port: 18_080,
      installDir,
      service: "web",
      probeInUse: true,
      expectedProjectName: "osva-test",
      execCtx: {
        installDir,
        envFilePath: path.join(installDir, ".env"),
        projectName: "osva-test",
      },
      spawn,
    });

    expect(result.ownership).toBe("unknown");
  });

  it("allows this installation when docker inspect shows the configured host port", async () => {
    const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-port-own-"));
    await writeFile(
      path.join(installDir, ".env"),
      "OSVA_PUBLISH_WEB_PORT=18080\n",
      "utf8",
    );
    await mkdir(path.join(installDir, ".osva"), { recursive: true });
    await writeFile(
      path.join(installDir, ".osva", "installation.json"),
      testInstallationMarker(installDir, "osva-test"),
      "utf8",
    );

    const composeSpy = vi.spyOn(composeExec, "runComposeCommand");
    composeSpy.mockImplementation((_ctx, args) => {
      if (args[0] === "ps" && args.includes("json")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              ID: "abc123container",
              Service: "web",
              Project: "osva-test",
            },
          ]),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    });

    const spawn: ProbeSpawnFn = (command, args) => {
      if (command === "docker" && args[0] === "inspect") {
        return {
          status: 0,
          stdout: JSON.stringify({
            "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18080" }],
          }),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    };

    const result = await assessLoopbackPortOwnership({
      port: 18_080,
      installDir,
      service: "web",
      probeInUse: true,
      expectedProjectName: "osva-test",
      execCtx: {
        installDir,
        envFilePath: path.join(installDir, ".env"),
        projectName: "osva-test",
      },
      spawn,
    });

    expect(result.ownership).toBe("this_installation");
  });

  it("rejects another OSVA installation discovered via global docker ps", async () => {
    const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-port-own-"));
    await writeFile(
      path.join(installDir, ".env"),
      "OSVA_PUBLISH_WEB_PORT=18080\n",
      "utf8",
    );
    await mkdir(path.join(installDir, ".osva"), { recursive: true });
    await writeFile(
      path.join(installDir, ".osva", "installation.json"),
      testInstallationMarker(installDir, "osva-test"),
      "utf8",
    );

    const composeSpy = vi.spyOn(composeExec, "runComposeCommand");
    composeSpy.mockImplementation((_ctx, args) => {
      if (args[0] === "ps" && args.includes("json")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              ID: "localcontainer",
              Service: "web",
              Project: "osva-test",
            },
          ]),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    });

    const spawn: ProbeSpawnFn = (command, args) => {
      if (command === "docker" && args[0] === "inspect") {
        return {
          status: 0,
          stdout: JSON.stringify({ "8080/tcp": [] }),
          stderr: "",
          error: undefined,
        };
      }
      if (command === "docker" && args[0] === "ps") {
        return {
          status: 0,
          stdout: [
            JSON.stringify({
              ID: "foreigncontainer",
              Ports: "127.0.0.1:18080->8080/tcp",
              Labels: {
                "com.docker.compose.project": "osva-other-install",
                "com.docker.compose.service": "web",
              },
            }),
          ].join("\n"),
          stderr: "",
          error: undefined,
        };
      }
      return { status: 1, stdout: "", stderr: "", error: undefined };
    };

    const result = await assessLoopbackPortOwnership({
      port: 18_080,
      installDir,
      service: "web",
      probeInUse: true,
      expectedProjectName: "osva-test",
      execCtx: {
        installDir,
        envFilePath: path.join(installDir, ".env"),
        projectName: "osva-test",
      },
      spawn,
    });

    expect(result.ownership).toBe("other_osva_installation");
  });
});
