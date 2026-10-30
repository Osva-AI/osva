import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { redactSecrets } from "../src/doctor/index.js";
import {
  parsePortNumber,
  readSetupOptions,
  runSetupCommand,
  runSetupPipeline,
  setupExitCode,
} from "../src/setup/index.js";
import type { ProbeSpawnFn } from "../src/setup/probe-spawn.js";
import type { LoopbackPortProbeFn } from "../src/setup/run-setup.js";

const TEST_API_KEY = "osva_ak_test.secretvalue";

function setupOptions(
  partial: Partial<import("../src/setup/read-options.js").SetupOptions> & {
    readonly webPort: number;
    readonly mcpPort: number;
  },
): import("../src/setup/read-options.js").SetupOptions {
  return {
    installDir: partial.installDir ?? "C:\\Users\\Example\\.osva\\install",
    preflightOnly: partial.preflightOnly ?? false,
    authorizeExisting: partial.authorizeExisting ?? false,
    webPort: partial.webPort,
    mcpPort: partial.mcpPort,
    consolePort: partial.consolePort ?? 4174,
    adminEmail: partial.adminEmail ?? "",
    adminName: partial.adminName ?? "Initial Owner",
    organizationName: partial.organizationName ?? "Default Organization",
    workspaceName: partial.workspaceName ?? "Default Workspace",
  };
}

describe("osva setup preflight", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("validates publish ports strictly", () => {
    expect(() => parsePortNumber("8080abc", "web-port")).toThrow(/integer/);
    expect(() => parsePortNumber("8080.5", "web-port")).toThrow(/integer/);
    expect(() => parsePortNumber("-1", "web-port")).toThrow(/integer/);
    expect(() => parsePortNumber("0", "web-port")).toThrow(/integer/);
    expect(() => parsePortNumber("70000", "web-port")).toThrow(/integer/);
    expect(parsePortNumber("8080", "web-port")).toBe(8080);
  });

  it("defaults ports and prefers CLI flags over environment", () => {
    expect(readSetupOptions({}, {}, "linux")).toMatchObject({
      webPort: 8080,
      mcpPort: 3100,
      preflightOnly: false,
      authorizeExisting: false,
    });
    expect(
      readSetupOptions(
        { "web-port": "9001", "mcp-port": "9002" },
        { OSVA_PUBLISH_WEB_PORT: "7001", OSVA_PUBLISH_MCP_PORT: "7002" },
      ),
    ).toMatchObject({ webPort: 9001, mcpPort: 9002 });
    expect(
      readSetupOptions(
        {},
        { OSVA_PUBLISH_WEB_PORT: "9003", OSVA_PUBLISH_MCP_PORT: "9004" },
      ),
    ).toMatchObject({ webPort: 9003, mcpPort: 9004 });
    expect(
      readSetupOptions(
        {},
        { OSVA_PUBLISH_WEB_PORT: "", OSVA_PUBLISH_MCP_PORT: "   " },
      ),
    ).toMatchObject({ webPort: 8080, mcpPort: 3100 });
  });

  it("rejects identical web and MCP publish ports", () => {
    expect(() =>
      readSetupOptions({ "web-port": "9090", "mcp-port": "9090" }, {}),
    ).toThrow(/distinct|must differ/i);
  });

  it("reports host architecture", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_000, mcpPort: 40_001 }),
      { spawn: healthyDockerSpawn(), arch: "x64" },
    );
    expect(
      report.checks.find((check) => check.id === "host_architecture")?.message,
    ).toContain("x64");
  });

  it("fails when the Docker CLI is missing", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_002, mcpPort: 40_003 }),
      { spawn: missingDockerSpawn() },
    );
    expect(
      report.checks.find((check) => check.id === "docker_cli")?.status,
    ).toBe("FAIL");
    expect(
      report.checks.find((check) => check.id === "docker_engine")?.status,
    ).toBe("SKIP");
    expect(report.result).toBe("fail");
  });

  it("fails when the Docker daemon is unavailable", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_004, mcpPort: 40_005 }),
      { spawn: dockerDaemonDownSpawn() },
    );
    expect(
      report.checks.find((check) => check.id === "docker_engine")?.status,
    ).toBe("FAIL");
    expect(report.result).toBe("fail");
  });

  it("fails when Docker Compose v2 is unavailable", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_006, mcpPort: 40_007 }),
      { spawn: dockerComposeMissingSpawn() },
    );
    expect(
      report.checks.find((check) => check.id === "docker_compose")?.status,
    ).toBe("FAIL");
    expect(report.result).toBe("fail");
  });

  it("fails when a publish port is occupied", async () => {
    const server = await listenOnPort(servers, 0);
    const report = await runSetupPipeline(
      setupOptions({ webPort: server.port, mcpPort: server.port + 1 }),
      { spawn: healthyDockerSpawn() },
    );
    const webCheck = report.checks.find(
      (check) => check.id === "publish_web_port",
    );
    expect(webCheck?.status).toBe("FAIL");
    expect(webCheck?.message).toContain("already in use");
    expect(webCheck?.message).toContain("127.0.0.1");
    expect(report.result).toBe("fail");
  });

  it("distinguishes permission denied from address in use", async () => {
    const probe: LoopbackPortProbeFn = async (port) =>
      port === 40_020 ? { kind: "permission_denied" } : { kind: "available" };
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_020, mcpPort: 40_021 }),
      { spawn: healthyDockerSpawn(), probeLoopbackPort: probe },
    );
    const webCheck = report.checks.find(
      (check) => check.id === "publish_web_port",
    );
    expect(webCheck?.status).toBe("FAIL");
    expect(webCheck?.message).toContain("permission denied");
    expect(
      report.checks.find((check) => check.id === "publish_mcp_port")?.status,
    ).toBe("PASS");
  });

  it("fails docker probes that time out", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_022, mcpPort: 40_023 }),
      { spawn: dockerTimedOutSpawn() },
    );
    expect(
      report.checks.find((check) => check.id === "docker_engine")?.status,
    ).toBe("FAIL");
    expect(
      report.checks.find((check) => check.id === "docker_engine")?.message,
    ).toContain("timed out");
  });

  it("emits stable JSON output without secrets", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = await runSetupCommand(
      { json: true },
      { OSVA_PUBLISH_WEB_PORT: "40100", OSVA_PUBLISH_MCP_PORT: "40101" },
      {
        spawn: dockerDaemonDownSpawn(`Cannot connect: Bearer ${TEST_API_KEY}`),
      },
    );
    expect(code).toBe(1);
    expect(stdout.mock.calls).toHaveLength(1);
    const output = String(stdout.mock.calls[0]?.[0]);
    expect(output.trimStart().startsWith("{")).toBe(true);
    expect(output.endsWith("\n")).toBe(true);
    expect(output).not.toContain(TEST_API_KEY);
    expect(output).toContain("Bearer ***");
    const payload = JSON.parse(output) as {
      result: string;
      checks: Array<{ id: string; status: string; remediation?: string }>;
    };
    expect(payload.result).toBe("fail");
    expect(payload.checks.every((check) => typeof check.id === "string")).toBe(
      true,
    );
    expect(
      payload.checks.find((check) => check.id === "docker_engine")?.status,
    ).toBe("FAIL");
    stdout.mockRestore();
  });

  it("redacts sensitive values from docker probe messages", () => {
    const redacted = redactSecrets(
      `daemon error Bearer ${TEST_API_KEY} at postgres://user:secret@127.0.0.1:5432/db`,
    );
    expect(redacted).not.toContain(TEST_API_KEY);
    expect(redacted).not.toContain("secret@");
    expect(redacted).toContain("Bearer ***");
  });

  it("maps overall exit codes", () => {
    expect(setupExitCode({ result: "pass", checks: [] })).toBe(0);
    expect(setupExitCode({ result: "warn", checks: [] })).toBe(0);
    expect(setupExitCode({ result: "fail", checks: [] })).toBe(1);
  });

  it("warns on untested host platforms", async () => {
    const report = await runSetupPipeline(
      setupOptions({ webPort: 40_010, mcpPort: 40_011 }),
      { spawn: healthyDockerSpawn(), platform: "freebsd" },
    );
    expect(
      report.checks.find((check) => check.id === "host_platform")?.status,
    ).toBe("WARN");
    expect(report.result).toBe("warn");
  });

  const dockerAvailable = process.env.OSVA_SETUP_DOCKER_PROBE === "1";

  it.skipIf(!dockerAvailable)(
    "uses real Docker when OSVA_SETUP_DOCKER_PROBE=1",
    async () => {
      const report = await runSetupPipeline(
        setupOptions({ webPort: 40_012, mcpPort: 40_013 }),
      );
      expect(
        report.checks.find((check) => check.id === "docker_cli")?.status,
      ).toBe("PASS");
    },
  );
});

function healthyDockerSpawn(): ProbeSpawnFn {
  return (executable, args) => {
    expect(executable).toBe("docker");
    const joined = args.join(" ");
    if (joined === "--version") {
      return {
        status: 0,
        stdout: "Docker version 27.0.0, build test\n",
        stderr: "",
        error: undefined,
      };
    }
    if (joined === "info --format {{.ServerVersion}}") {
      return {
        status: 0,
        stdout: "27.0.0\n",
        stderr: "",
        error: undefined,
      };
    }
    if (joined === "compose version") {
      return {
        status: 0,
        stdout: "Docker Compose version v2.29.0\n",
        stderr: "",
        error: undefined,
      };
    }
    throw new Error(`Unexpected docker invocation: ${joined}`);
  };
}

function missingDockerSpawn(): ProbeSpawnFn {
  return () => ({
    status: null,
    stdout: "",
    stderr: "spawn docker ENOENT",
    error: Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }),
  });
}

function dockerDaemonDownSpawn(stderrDetail?: string): ProbeSpawnFn {
  return (executable, args) => {
    expect(executable).toBe("docker");
    const joined = args.join(" ");
    if (joined === "--version") {
      return {
        status: 0,
        stdout: "Docker version 27.0.0, build test\n",
        stderr: "",
        error: undefined,
      };
    }
    if (joined === "info --format {{.ServerVersion}}") {
      return {
        status: 1,
        stdout: "",
        stderr:
          stderrDetail ??
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
        error: undefined,
      };
    }
    if (joined === "compose version") {
      return {
        status: 0,
        stdout: "Docker Compose version v2.29.0\n",
        stderr: "",
        error: undefined,
      };
    }
    throw new Error(`Unexpected docker invocation: ${joined}`);
  };
}

function dockerTimedOutSpawn(): ProbeSpawnFn {
  return (executable, args) => {
    const joined = args.join(" ");
    if (joined === "--version") {
      return healthyDockerSpawn()(executable, args, 5_000);
    }
    if (joined === "info --format {{.ServerVersion}}") {
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), {
          code: "ETIMEDOUT",
        }),
      };
    }
    if (joined === "compose version") {
      return healthyDockerSpawn()(executable, args, 5_000);
    }
    throw new Error(`Unexpected docker invocation: ${joined}`);
  };
}

function dockerComposeMissingSpawn(): ProbeSpawnFn {
  return (executable, args) => {
    const joined = args.join(" ");
    if (
      joined === "--version" ||
      joined === "info --format {{.ServerVersion}}"
    ) {
      return healthyDockerSpawn()(executable, args, 5_000);
    }
    if (joined === "compose version") {
      return {
        status: 1,
        stdout: "",
        stderr: "docker: 'compose' is not a docker command.",
        error: undefined,
      };
    }
    throw new Error(`Unexpected docker invocation: ${joined}`);
  };
}

async function listenOnPort(
  servers: http.Server[],
  port: number,
): Promise<{ port: number }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind ephemeral port.");
  }
  return { port: address.port };
}

async function closeServers(servers: http.Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
  servers.length = 0;
}
