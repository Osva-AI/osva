import { RuntimeExecutionBootstrapStore } from "@osva/adapters-runtime-http";
import type { ExecutionRequest, RunAttemptId } from "@osva/contracts";
import { RUNTIME_PROTOCOL_ERROR_CODES } from "@osva/runtime-protocol";
import { RuntimeDispatcher } from "@osva/runtime-core";
import { describe, expect, it } from "vitest";

import { ContainerRuntimeAdapter } from "../src/container-runtime-adapter.js";
import { DEFAULT_CONTAINER_RESOURCE_POLICY } from "../src/resource-policy.js";
import { FakeContainerEngine } from "./fake-container-engine.js";

const CAPABILITY_SECRET = "capability-secret";
const CAPABILITY_BASE_URL = "http://127.0.0.1:8080";
const IMAGE = `registry.example.com/agent@sha256:${"a".repeat(64)}`;
const NOW = new Date("2026-01-15T12:00:00.000Z");

function containerRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId: "run-1" as ExecutionRequest["runId"],
    runAttemptId: "run-attempt-1" as RunAttemptId,
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "agent-version-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "CONTAINER",
      protocolVersion: "1",
      image: IMAGE,
    },
    input: { prompt: "hello" },
    effectiveConfig: {},
    modelProfileVersionBindings: { primary: "mpv-1" as never },
    toolVersionBindings: { echo: "tv-1" as never },
    memoryNamespaceBindings: {},
    toolGrants: [],
    timeoutMs: 2_000,
    policyContext: {},
    ...overrides,
  };
}

function createAdapter(engine = new FakeContainerEngine()) {
  const executionBootstrap = new RuntimeExecutionBootstrapStore();
  const logs: Array<{
    event: string;
    fields?: Readonly<Record<string, unknown>>;
  }> = [];
  const adapter = new ContainerRuntimeAdapter({
    engine,
    resourcePolicy: DEFAULT_CONTAINER_RESOURCE_POLICY,
    getCapabilityBaseUrl: () => CAPABILITY_BASE_URL,
    capabilitySecret: CAPABILITY_SECRET,
    executionBootstrap,
    clock: { now: () => NOW },
    stopGraceMs: 0,
    logger: {
      info(event, fields) {
        logs.push({ event, fields });
      },
      error() {
        return;
      },
    },
  });
  return { adapter, engine, logs, executionBootstrap };
}

function successStdout(output: unknown = { prompt: "hello" }): string {
  return `${JSON.stringify({
    protocolVersion: "1",
    executionId: "run-attempt-1",
    outcome: "SUCCEEDED",
    output,
  })}\n`;
}

describe("ContainerRuntimeAdapter", () => {
  it("registers bootstrap RuntimeExecuteRequest and injects bootstrap env vars", async () => {
    const engine = new FakeContainerEngine();
    const { adapter, logs } = createAdapter(engine);
    let capturedBootstrap:
      | {
          executionId: string;
          bootstrapUrl: string;
          bootstrapToken: string;
        }
      | undefined;
    engine.createContainerImpl = async (options) => {
      capturedBootstrap = options.bootstrap;
      return { id: "container-1" };
    };
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
      stdoutBytes: successStdout().length,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await adapter.execute(containerRequest());
    expect(result).toEqual({
      status: "succeeded",
      output: { prompt: "hello" },
    });
    expect(capturedBootstrap?.executionId).toBe("run-attempt-1");
    expect(capturedBootstrap?.bootstrapUrl).toBe(
      `${CAPABILITY_BASE_URL}/v1/runtime/executions/bootstrap?executionId=run-attempt-1`,
    );
    expect(capturedBootstrap?.bootstrapToken.length).toBeGreaterThan(0);

    expect(JSON.stringify(logs)).not.toContain(
      capturedBootstrap?.bootstrapToken ?? "",
    );
    expect(engine.calls).toContain("removeContainer");
  });

  it("returns normalized agent failure for valid FAILED protocol responses", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 1,
      stdout: `${JSON.stringify({
        protocolVersion: "1",
        executionId: "run-attempt-1",
        outcome: "FAILED",
        error: { code: "AGENT_ERROR", message: "boom" },
      })}\n`,
      stderr: "diagnostic",
      stdoutBytes: 100,
      stderrBytes: 9,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toEqual({
      status: "failed",
      error: {
        code: RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED,
        message: "boom",
      },
    });
  });

  it.each([
    ["malformed", "{not-json"],
    [
      "mismatched executionId",
      `${JSON.stringify({
        protocolVersion: "1",
        executionId: "other",
        outcome: "SUCCEEDED",
        output: {},
      })}\n`,
    ],
    [
      "unsupported protocol version",
      `${JSON.stringify({
        protocolVersion: "2",
        executionId: "run-attempt-1",
        outcome: "SUCCEEDED",
        output: {},
      })}\n`,
    ],
    ["multiple responses", `${successStdout()}${successStdout()}`],
  ])("fails deterministically for %s stdout", async (_label, stdout) => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout,
      stderr: "",
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
      );
    }
  });

  it("does not create a replacement container for empty protocol stdout", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        message: "Container runtime returned an empty protocol response.",
      },
    });
    expect(
      engine.calls.filter((call) => call === "createContainer"),
    ).toHaveLength(1);
    expect(
      engine.calls.filter((call) => call === "runProtocolExecution"),
    ).toHaveLength(1);
  });

  it("does not create a replacement container for post-start transport failures", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Extra data: line 1 column 71 (char 70)",
      stdoutBytes: 0,
      stderrBytes: 39,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE },
    });
    expect(
      engine.calls.filter((call) => call === "createContainer"),
    ).toHaveLength(1);
    expect(
      engine.calls.filter((call) => call === "runProtocolExecution"),
    ).toHaveLength(1);
  });

  it("does not create a replacement container when runProtocolExecution throws after start", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => {
      throw new Error("attach stream closed unexpectedly");
    };
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE },
    });
    expect(
      engine.calls.filter((call) => call === "createContainer"),
    ).toHaveLength(1);
    expect(
      engine.calls.filter((call) => call === "runProtocolExecution"),
    ).toHaveLength(1);
  });

  it("treats zero exit without valid response as protocol failure", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: "\n",
      stderr: "",
      stdoutBytes: 1,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE },
    });
  });

  it("treats non-zero exit without valid response as transport failure", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 137,
      stdout: "",
      stderr: "killed",
      stdoutBytes: 0,
      stderrBytes: 6,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE },
    });
  });

  it("fails protocol when stdout exceeds the bounded capture limit", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: "x".repeat(10),
      stderr: "",
      stdoutBytes: 2_000_000,
      stderrBytes: 0,
      stdoutTruncated: true,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE },
    });
  });

  it("cleans up containers after success, failure, and timeout", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
      stdoutBytes: 10,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);
    await adapter.execute(containerRequest());
    expect(
      engine.calls.filter((call) => call === "removeContainer"),
    ).toHaveLength(1);

    engine.resetCalls();
    engine.runProtocolExecutionImpl = async () => {
      throw new Error("Timed out waiting for container container-1.");
    };
    await adapter.execute(containerRequest());
    expect(engine.calls).toContain("killContainer");
    expect(engine.calls).toContain("removeContainer");
  });

  it("returns transport failure when container creation fails", async () => {
    const engine = new FakeContainerEngine();
    engine.createContainerImpl = async () => {
      throw new Error("create failed");
    };
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE },
    });
  });

  it("removes stale execution containers before creating a new one", async () => {
    const engine = new FakeContainerEngine();
    engine.findExecutionContainerImpl = async () => ({ id: "stale" });
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
      stdoutBytes: 10,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const { adapter } = createAdapter(engine);

    const result = await adapter.execute(containerRequest());
    expect(result.status).toBe("succeeded");
    expect(engine.calls).toContain("killContainer");
    expect(
      engine.calls.indexOf("findExecutionContainer:run-attempt-1"),
    ).toBeLessThan(engine.calls.indexOf("createContainer"));
    expect(
      engine.calls.filter((call) => call === "createContainer"),
    ).toHaveLength(1);
    expect(
      engine.calls.filter((call) => call === "runProtocolExecution"),
    ).toHaveLength(1);
  });

  it("terminates active executions on close", async () => {
    const engine = new FakeContainerEngine();
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    engine.runProtocolExecutionImpl = async () => {
      await runGate;
      return {
        exitCode: 0,
        stdout: successStdout(),
        stderr: "",
        stdoutBytes: 10,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    };
    const { adapter } = createAdapter(engine);
    const pending = adapter.execute(containerRequest());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await adapter.close();
    releaseRun?.();
    await pending;
    expect(engine.calls).toContain("killContainer");
  });

  it("fails when capability bridge is not configured", async () => {
    const misconfigured = new ContainerRuntimeAdapter({
      engine: new FakeContainerEngine(),
      resourcePolicy: DEFAULT_CONTAINER_RESOURCE_POLICY,
      getCapabilityBaseUrl: () => undefined,
      capabilitySecret: CAPABILITY_SECRET,
      executionBootstrap: new RuntimeExecutionBootstrapStore(),
    });

    const result = await misconfigured.execute(containerRequest());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE },
    });

    const noSecret = new ContainerRuntimeAdapter({
      engine: new FakeContainerEngine(),
      resourcePolicy: DEFAULT_CONTAINER_RESOURCE_POLICY,
      getCapabilityBaseUrl: () => CAPABILITY_BASE_URL,
      capabilitySecret: "",
      executionBootstrap: new RuntimeExecutionBootstrapStore(),
    });
    expect(await noSecret.execute(containerRequest())).toMatchObject({
      status: "failed",
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE },
    });
  });
});

describe("RuntimeDispatcher", () => {
  it("selects CONTAINER when registered", async () => {
    const engine = new FakeContainerEngine();
    engine.runProtocolExecutionImpl = async () => ({
      exitCode: 0,
      stdout: successStdout({ ok: true }),
      stderr: "",
      stdoutBytes: 10,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const dispatcher = new RuntimeDispatcher({
      executors: {
        CONTAINER: createAdapter(engine).adapter,
      },
    });

    const result = await dispatcher.execute(containerRequest());
    expect(result).toEqual({ status: "succeeded", output: { ok: true } });
  });
});
