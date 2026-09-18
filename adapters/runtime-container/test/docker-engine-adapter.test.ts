import { describe, expect, it } from "vitest";

import type { DockerApiClient } from "../src/docker-api-client.js";
import { DockerEngineAdapter } from "../src/docker-engine-adapter.js";
import { OSVA_CONTAINER_EXECUTION_ID_LABEL } from "../src/labels.js";

const bridgeNetwork = { networkMode: "bridge" };

function createFakeClient(
  overrides: Partial<DockerApiClient> = {},
): DockerApiClient {
  return {
    ping: async () => {},
    inspectImage: async () => ({}),
    pull: async () => {},
    createContainer: async () => ({ Id: "container-1" }),
    startContainer: async () => {},
    runContainerProtocolExecution: async () => ({
      StatusCode: 0,
      stdout:
        '{"protocolVersion":"1","executionId":"run-attempt-1","outcome":"SUCCEEDED","output":{}}\n',
      stderr: "",
      stdoutBytes: 90,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
    stopContainer: async () => {},
    killContainer: async () => {},
    removeContainer: async () => {},
    listContainersByLabel: async () => [],
    ...overrides,
  };
}

describe("DockerEngineAdapter", () => {
  it("rejects forbidden network modes at construction", () => {
    expect(
      () =>
        new DockerEngineAdapter({
          client: createFakeClient(),
          network: { networkMode: "host" },
        }),
    ).toThrowError(/forbidden/i);
  });

  it("pulls missing images during ensureImage", async () => {
    let pulled = false;
    const client = createFakeClient({
      inspectImage: async () => {
        const error = new Error("missing") as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      },
      pull: async () => {
        pulled = true;
      },
    });
    const engine = new DockerEngineAdapter({ client, network: bridgeNetwork });

    await engine.ensureImage({
      image: `registry.example.com/agent@sha256:${"a".repeat(64)}`,
    });
    expect(pulled).toBe(true);
  });

  it("creates containers from the isolated Docker spec", async () => {
    const image = `registry.example.com/agent@sha256:${"b".repeat(64)}`;
    let capturedImage: string | undefined;
    const client = createFakeClient({
      createContainer: async (spec) => {
        capturedImage = spec.Image;
        expect(spec.HostConfig.Privileged).toBe(false);
        expect(spec.HostConfig.Binds).toEqual([]);
        expect(spec.HostConfig.NetworkMode).toBe("bridge");
        return { Id: "container-1" };
      },
    });
    const engine = new DockerEngineAdapter({ client, network: bridgeNetwork });

    const container = await engine.createContainer({
      executionId: "run-attempt-1",
      image: { image },
      resources: {
        cpuMillis: 500,
        memoryMiB: 256,
        pids: 128,
      },
      bootstrap: {
        executionId: "run-attempt-1",
        bootstrapUrl:
          "http://host.docker.internal:8080/v1/runtime/executions/bootstrap?executionId=run-attempt-1",
        bootstrapToken: "bootstrap-token",
      },
    });

    expect(container.id).toBe("container-1");
    expect(capturedImage).toBe(image);
  });

  it("runs Runtime Protocol execution via Docker engine client", async () => {
    const client = createFakeClient({
      runContainerProtocolExecution: async () => ({
        StatusCode: 0,
        stdout:
          '{"protocolVersion":"1","executionId":"run-attempt-1","outcome":"SUCCEEDED","output":{"ok":true}}\n',
        stderr: "diagnostic",
        stdoutBytes: 100,
        stderrBytes: 10,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    });
    const engine = new DockerEngineAdapter({ client, network: bridgeNetwork });

    const result = await engine.runProtocolExecution(
      { id: "container-1" },
      {
        timeoutMs: 5_000,
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 65_536,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"outcome":"SUCCEEDED"');
    expect(result.stderr).toBe("diagnostic");
  });

  it("finds OSVA-managed execution containers by label", async () => {
    const client = createFakeClient({
      listContainersByLabel: async (label, value) => {
        expect(label).toBe(OSVA_CONTAINER_EXECUTION_ID_LABEL);
        expect(value).toBe("run-attempt-42");
        return [{ Id: "container-42" }];
      },
    });
    const engine = new DockerEngineAdapter({ client, network: bridgeNetwork });

    await expect(
      engine.findExecutionContainer("run-attempt-42"),
    ).resolves.toEqual({ id: "container-42" });
  });
});
