import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  doctorExitCode,
  redactSecrets,
  runDoctorCommand,
  runDoctorPipeline,
} from "../src/doctor/index.js";

const TEST_API_KEY = "osva_ak_test.secretvalue";
const OTHER_API_KEY = "osva_ak_other.secret";

describe("osva doctor", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("runs with no environment configuration", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = await runDoctorCommand({}, {});
    expect(code).toBe(1);
    const output = stdout.mock.calls.map(String).join("");
    expect(output).toContain("FAIL base_url");
    expect(output).toContain("SKIP api_reachability");
    stdout.mockRestore();
  });

  it("warns when base URL is set but API key is missing", async () => {
    const server = await startMockServer(servers, (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.url === "/ready") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
        return;
      }
      res.writeHead(404).end();
    });

    const report = await runDoctorPipeline(
      { baseUrl: server.origin },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(report.result).toBe("warn");
    expect(report.checks.find((c) => c.id === "api_key")?.status).toBe("WARN");
    expect(report.checks.find((c) => c.id === "authentication")?.status).toBe(
      "SKIP",
    );
  });

  it("fails when the endpoint is unreachable", async () => {
    const report = await runDoctorPipeline(
      { baseUrl: "http://127.0.0.1:1" },
      { probeTimeoutMs: 500 },
    );
    expect(report.checks.find((c) => c.id === "api_reachability")?.status).toBe(
      "FAIL",
    );
    expect(report.result).toBe("fail");
  });

  it("passes health and ready for a healthy service", async () => {
    const server = await startMockServer(servers, (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.url === "/ready") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
        return;
      }
      if (req.url === "/v1/auth/context") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const report = await runDoctorPipeline(
      { baseUrl: server.origin, apiKey: TEST_API_KEY },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(report.result).toBe("pass");
    expect(report.checks.find((c) => c.id === "api_reachability")?.status).toBe(
      "PASS",
    );
    expect(
      report.checks.find((c) => c.id === "control_plane_ready")?.status,
    ).toBe("PASS");
    expect(report.checks.find((c) => c.id === "authentication")?.status).toBe(
      "PASS",
    );
  });

  it("fails when the service is not ready", async () => {
    const server = await startMockServer(servers, (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.url === "/ready") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "unavailable",
            failedDependency: "postgres",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const report = await runDoctorPipeline(
      { baseUrl: server.origin, apiKey: TEST_API_KEY },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(
      report.checks.find((c) => c.id === "control_plane_ready")?.status,
    ).toBe("FAIL");
    expect(
      report.checks.find((c) => c.id === "control_plane_ready")?.message,
    ).toContain("postgres");
  });

  it("fails authentication for an invalid API key", async () => {
    const server = await startMockServer(servers, (req, res) => {
      if (req.url === "/health" || req.url === "/ready") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ status: req.url === "/health" ? "ok" : "ready" }),
        );
        return;
      }
      if (req.url === "/v1/auth/context") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            status: "error",
            code: "AUTHENTICATION_REQUIRED",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const report = await runDoctorPipeline(
      { baseUrl: server.origin, apiKey: OTHER_API_KEY },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(report.checks.find((c) => c.id === "authentication")?.status).toBe(
      "FAIL",
    );
    expect(report.result).toBe("fail");
  });

  it("validates workspace access when OSVA_WORKSPACE_ID is set", async () => {
    const server = await startMockServer(servers, (req, res) => {
      if (req.url === "/health" || req.url === "/ready") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ status: req.url === "/health" ? "ok" : "ready" }),
        );
        return;
      }
      if (req.url === "/v1/auth/context") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            subjectId: "sub-1",
            workspaceId: "ws-expected",
            role: "ADMIN",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const mismatch = await runDoctorPipeline(
      {
        baseUrl: server.origin,
        apiKey: TEST_API_KEY,
        workspaceId: "ws-other",
      },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(
      mismatch.checks.find((c) => c.id === "workspace_access")?.status,
    ).toBe("FAIL");

    const match = await runDoctorPipeline(
      {
        baseUrl: server.origin,
        apiKey: TEST_API_KEY,
        workspaceId: "ws-expected",
      },
      { fetch: server.fetch, probeTimeoutMs: 2_000 },
    );
    expect(match.checks.find((c) => c.id === "workspace_access")?.status).toBe(
      "PASS",
    );
  });

  it("emits stable JSON output", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runDoctorCommand({ json: true }, {});
    const payload = JSON.parse(String(stdout.mock.calls[0]?.[0])) as {
      result: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.result).toBe("fail");
    expect(payload.checks.every((check) => typeof check.id === "string")).toBe(
      true,
    );
    stdout.mockRestore();
  });

  it("times out slow health probes", async () => {
    const server = await startMockServer(servers, () => {
      // Never respond
    });

    const report = await runDoctorPipeline(
      { baseUrl: server.origin },
      { fetch: server.fetch, probeTimeoutMs: 50 },
    );
    expect(report.checks.find((c) => c.id === "api_reachability")?.status).toBe(
      "FAIL",
    );
    expect(
      report.checks.find((c) => c.id === "api_reachability")?.message,
    ).toContain("Timed out");
  });

  it("redacts sensitive values from messages", () => {
    const redacted = redactSecrets(
      `Bearer ${TEST_API_KEY} at http://user:pass@127.0.0.1:1/${TEST_API_KEY}`,
    );
    expect(redacted).not.toContain(TEST_API_KEY);
    expect(redacted).not.toContain("pass@");
    expect(redacted).toContain("osva_ak_***");
  });

  it("maps overall exit codes", () => {
    expect(doctorExitCode({ result: "pass", checks: [] })).toBe(0);
    expect(doctorExitCode({ result: "warn", checks: [] })).toBe(0);
    expect(doctorExitCode({ result: "fail", checks: [] })).toBe(1);
  });
});

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

async function startMockServer(
  servers: http.Server[],
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{
  origin: string;
  fetch: typeof fetch;
}> {
  const server = http.createServer((req, res) => {
    handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Mock server failed to bind.");
  }
  servers.push(server);
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return fetch(url, init);
  };
  return { origin, fetch: fetchImpl };
}
