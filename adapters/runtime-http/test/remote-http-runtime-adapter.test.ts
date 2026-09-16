import type { ExecutionRequest, RunAttemptId } from "@osva/contracts";
import { MemorySecretResolver } from "@osva/adapters-memory";
import { describe, expect, it } from "vitest";

import { fetchWithPinnedConnection } from "../src/pinned-fetch.js";
import { RemoteHttpRuntimeAdapter } from "../src/remote-http-runtime-adapter.js";
import { startFakeRemoteRuntime } from "./fake-remote-runtime.js";

const CAPABILITY_SECRET = "capability-secret";
const NOW = new Date("2026-01-15T12:00:00.000Z");

function remoteRequest(
  endpoint: string,
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId: "run-1" as ExecutionRequest["runId"],
    runAttemptId: "run-attempt-1" as RunAttemptId,
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "agent-version-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "REMOTE_HTTP",
      protocolVersion: "1",
      endpoint,
    },
    input: { prompt: "hello" },
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    toolGrants: [],
    timeoutMs: 2_000,
    policyContext: {},
    ...overrides,
  };
}

function createAdapter(
  endpointBaseUrl = "http://127.0.0.1:9",
  overrides: Partial<
    ConstructorParameters<typeof RemoteHttpRuntimeAdapter>[0]
  > = {},
) {
  const logs: Array<{
    event: string;
    fields?: Readonly<Record<string, unknown>>;
  }> = [];
  const adapter = new RemoteHttpRuntimeAdapter({
    secretResolver: new MemorySecretResolver({
      OSVA_REMOTE_RUNTIME_TOKEN: "remote-auth",
    }),
    getCapabilityBaseUrl: () => endpointBaseUrl,
    capabilitySecret: CAPABILITY_SECRET,
    allowPrivateNetworks: true,
    clock: { now: () => NOW },
    logger: {
      info(event, fields) {
        logs.push({ event, fields });
      },
      error() {
        return;
      },
    },
    ...overrides,
  });
  return { adapter, logs };
}

describe("RemoteHttpRuntimeAdapter", () => {
  it("posts Runtime Protocol V1 with executionId equal to RunAttemptId", async () => {
    const remote = await startFakeRemoteRuntime();
    const { adapter, logs } = createAdapter();
    try {
      const result = await adapter.execute(
        remoteRequest(`${remote.origin}/execute`),
      );
      expect(result).toEqual({
        status: "succeeded",
        output: { prompt: "hello" },
      });
      expect(remote.executeCount).toBe(1);
      expect(remote.lastRequest?.body).toMatchObject({
        protocolVersion: "1",
        executionId: "run-attempt-1",
        input: { prompt: "hello" },
      });
      expect(remote.lastRequest?.body.capabilities.token).toBeTruthy();
      expect(JSON.stringify(logs)).not.toContain(
        remote.lastRequest?.body.capabilities.token,
      );
    } finally {
      await remote.close();
    }
  });

  it("reuses the same executionId for the same RunAttempt and issues a new one for a new attempt", async () => {
    const remote = await startFakeRemoteRuntime({ dedupe: true });
    const { adapter } = createAdapter();
    try {
      const first = remoteRequest(`${remote.origin}/execute`);
      await adapter.execute(first);
      await adapter.execute(first);
      await adapter.execute({
        ...first,
        runAttemptId: "run-attempt-2" as RunAttemptId,
      });
      expect(remote.requests.map((item) => item.body.executionId)).toEqual([
        "run-attempt-1",
        "run-attempt-1",
        "run-attempt-2",
      ]);
      expect(remote.logicalExecuteCount).toBe(2);
    } finally {
      await remote.close();
    }
  });

  it("does not automatically retry a timed-out execution POST", async () => {
    const remote = await startFakeRemoteRuntime({ delayMs: 250 });
    let pinnedFetchCalls = 0;
    const adapter = new RemoteHttpRuntimeAdapter({
      secretResolver: new MemorySecretResolver({
        OSVA_REMOTE_RUNTIME_TOKEN: "remote-auth",
      }),
      getCapabilityBaseUrl: () => "http://127.0.0.1:9",
      capabilitySecret: CAPABILITY_SECRET,
      allowPrivateNetworks: true,
      clock: { now: () => NOW },
      pinnedFetch: async (connection, init) => {
        pinnedFetchCalls += 1;
        return fetchWithPinnedConnection(connection, init);
      },
    });
    try {
      const result = await adapter.execute(
        remoteRequest(`${remote.origin}/execute`, { timeoutMs: 100 }),
      );
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error.code).toBe("RUNTIME_TRANSPORT_FAILURE");
      }
      expect(pinnedFetchCalls).toBe(1);
    } finally {
      await remote.close();
    }
  });

  it("treats redirects as transport failure without following them", async () => {
    const remote = await startFakeRemoteRuntime({
      redirectLocation: "https://evil.example/steal",
    });
    const { adapter } = createAdapter();
    try {
      const result = await adapter.execute(
        remoteRequest(`${remote.origin}/execute`),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "RUNTIME_TRANSPORT_FAILURE" },
      });
      expect(remote.executeCount).toBe(1);
    } finally {
      await remote.close();
    }
  });

  it("classifies protocol, transport, and agent failures", async () => {
    const cases = [
      {
        options: { rawBody: "{" },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
      {
        options: { contentType: "text/plain", rawBody: '{"ok":true}' },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
      {
        options: {
          response: {
            protocolVersion: "1",
            executionId: "other-attempt",
            outcome: "SUCCEEDED",
            output: {},
          },
        },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
      {
        options: {
          response: {
            protocolVersion: "2",
            executionId: "run-attempt-1",
            outcome: "SUCCEEDED",
            output: {},
          },
        },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
      {
        options: {
          response: {
            protocolVersion: "1",
            executionId: "run-attempt-1",
            outcome: "FAILED",
            error: { code: "AGENT_EXECUTION_FAILED", message: "agent boom" },
          },
        },
        code: "AGENT_EXECUTION_FAILED",
      },
      {
        options: {
          response: {
            protocolVersion: "1",
            executionId: "run-attempt-1",
            outcome: "FAILED",
            error: "nope",
          },
        },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
      {
        options: { status: 503 },
        code: "RUNTIME_TRANSPORT_FAILURE",
      },
      {
        options: { status: 404 },
        code: "RUNTIME_TRANSPORT_FAILURE",
      },
      {
        options: { oversizedBytes: 1_048_577 },
        code: "RUNTIME_PROTOCOL_FAILURE",
      },
    ] as const;

    for (const testCase of cases) {
      const remote = await startFakeRemoteRuntime(testCase.options);
      const { adapter } = createAdapter();
      try {
        const result = await adapter.execute(
          remoteRequest(`${remote.origin}/execute`),
        );
        expect(result.status, JSON.stringify(testCase.options)).toBe("failed");
        if (result.status === "failed") {
          expect(result.error.code).toBe(testCase.code);
        }
        expect(remote.executeCount).toBe(1);
      } finally {
        await remote.close();
      }
    }
  });

  it("fails a connection error as transport failure without retrying", async () => {
    const { adapter } = createAdapter();
    const result = await adapter.execute(
      remoteRequest("http://127.0.0.1:1/execute"),
    );
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "RUNTIME_TRANSPORT_FAILURE" },
    });
  });

  it("sends resolved secret-ref auth and never logs it", async () => {
    const remote = await startFakeRemoteRuntime();
    const { adapter, logs } = createAdapter();
    try {
      await adapter.execute(
        remoteRequest(`${remote.origin}/execute`, {
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: `${remote.origin}/execute`,
            authSecretRef: { key: "OSVA_REMOTE_RUNTIME_TOKEN" },
          },
        }),
      );
      expect(remote.lastRequest?.authorization).toBe("Bearer remote-auth");
      expect(JSON.stringify(logs)).not.toContain("remote-auth");
      expect(JSON.stringify(logs)).not.toContain("Bearer");
    } finally {
      await remote.close();
    }
  });

  it.each([
    "http://127.0.0.1/execute",
    "http://[::1]/execute",
    "http://169.254.169.254/latest/meta-data",
    "http://10.4.4.4/execute",
    "http://172.20.0.2/execute",
    "http://192.168.10.2/execute",
    "http://localhost/execute",
  ])(
    "does not POST to forbidden destination %s by default",
    async (endpoint) => {
      let pinnedFetchCalls = 0;
      const { adapter } = createAdapter("http://127.0.0.1:9", {
        allowPrivateNetworks: false,
        pinnedFetch: async () => {
          pinnedFetchCalls += 1;
          throw new Error("pinned fetch must not run");
        },
      });
      const result = await adapter.execute(remoteRequest(endpoint));
      expect(result).toMatchObject({
        status: "failed",
        error: {
          code: "RUNTIME_TRANSPORT_FAILURE",
          message: "Remote runtime endpoint is not an allowed destination.",
        },
      });
      expect(pinnedFetchCalls).toBe(0);
    },
  );

  it("does not POST when DNS resolves a public hostname to a private address", async () => {
    let pinnedFetchCalls = 0;
    const { adapter } = createAdapter("http://127.0.0.1:9", {
      allowPrivateNetworks: false,
      lookup: async () => [{ address: "192.168.1.50", family: 4 }],
      pinnedFetch: async () => {
        pinnedFetchCalls += 1;
        throw new Error("pinned fetch must not run");
      },
    });
    const result = await adapter.execute(
      remoteRequest("https://runtime.example.com/execute"),
    );
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "RUNTIME_TRANSPORT_FAILURE" },
    });
    expect(pinnedFetchCalls).toBe(0);
  });

  it("POSTs once to a pinned public address after stubbed public DNS", async () => {
    let pinnedFetchCalls = 0;
    let pinnedConnection:
      | {
          url: URL;
          hostname: string;
          address: { address: string; family: 4 | 6 };
        }
      | undefined;
    const { adapter } = createAdapter("http://127.0.0.1:9", {
      allowPrivateNetworks: false,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      pinnedFetch: async (connection, init) => {
        pinnedFetchCalls += 1;
        pinnedConnection = connection;
        expect(init.method).toBe("POST");
        return new Response(
          JSON.stringify({
            protocolVersion: "1",
            executionId: "run-attempt-1",
            outcome: "SUCCEEDED",
            output: { ok: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await adapter.execute(
      remoteRequest("https://runtime.example.com/execute"),
    );
    expect(result).toEqual({ status: "succeeded", output: { ok: true } });
    expect(pinnedFetchCalls).toBe(1);
    expect(pinnedConnection).toMatchObject({
      hostname: "runtime.example.com",
      address: { address: "93.184.216.34", family: 4 },
    });
    expect(pinnedConnection?.url.toString()).toBe(
      "https://runtime.example.com/execute",
    );
  });

  it("does not connect through a later rebinding lookup result", async () => {
    const remote = await startFakeRemoteRuntime();
    let lookupCalls = 0;
    const { adapter } = createAdapter("http://127.0.0.1:9", {
      allowPrivateNetworks: false,
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls === 1) {
          return [{ address: "93.184.216.34", family: 4 }];
        }
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    try {
      const result = await adapter.execute(
        remoteRequest("http://rebind.example/execute"),
      );
      expect(lookupCalls).toBe(1);
      expect(remote.executeCount).toBe(0);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "RUNTIME_TRANSPORT_FAILURE" },
      });
    } finally {
      await remote.close();
    }
  });

  it("allows a loopback destination only when the operator opts in", async () => {
    const remote = await startFakeRemoteRuntime();
    try {
      const denied = createAdapter(undefined, { allowPrivateNetworks: false });
      const deniedResult = await denied.adapter.execute(
        remoteRequest(`${remote.origin}/execute`),
      );
      expect(deniedResult).toMatchObject({
        status: "failed",
        error: { code: "RUNTIME_TRANSPORT_FAILURE" },
      });
      expect(remote.executeCount).toBe(0);

      const allowed = createAdapter(undefined, { allowPrivateNetworks: true });
      const allowedResult = await allowed.adapter.execute(
        remoteRequest(`${remote.origin}/execute`),
      );
      expect(allowedResult.status).toBe("succeeded");
      expect(remote.executeCount).toBe(1);
    } finally {
      await remote.close();
    }
  });
});
