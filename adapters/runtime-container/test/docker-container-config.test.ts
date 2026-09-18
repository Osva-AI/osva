import { describe, expect, it } from "vitest";

import {
  buildDockerCreateContainerSpec,
  cpuMillisToNanoCpus,
  memoryMiBToBytes,
} from "../src/docker-container-config.js";
import {
  OSVA_CONTAINER_EXECUTION_ID_LABEL,
  OSVA_CONTAINER_MANAGED_LABEL,
} from "../src/labels.js";

const baseOptions = {
  executionId: "run-attempt-1",
  image: {
    image: `registry.example.com/agent@sha256:${"a".repeat(64)}`,
  },
  resources: {
    cpuMillis: 750,
    memoryMiB: 512,
    pids: 256,
  },
  bootstrap: {
    executionId: "run-attempt-1",
    bootstrapUrl:
      "http://host.docker.internal:8080/v1/runtime/executions/bootstrap?executionId=run-attempt-1",
    bootstrapToken: "bootstrap-token",
  },
};

const bridgeNetwork = { networkMode: "bridge" };

describe("buildDockerCreateContainerSpec", () => {
  it("maps resolved resources onto Docker host limits", () => {
    const spec = buildDockerCreateContainerSpec(baseOptions, bridgeNetwork);
    expect(spec.HostConfig.NanoCpus).toBe(cpuMillisToNanoCpus(750));
    expect(spec.HostConfig.Memory).toBe(memoryMiBToBytes(512));
    expect(spec.HostConfig.PidsLimit).toBe(256);
  });

  it("includes optional command overrides", () => {
    const spec = buildDockerCreateContainerSpec(
      {
        ...baseOptions,
        command: ["node", "dist/index.js"],
      },
      bridgeNetwork,
    );
    expect(spec.Cmd).toEqual(["node", "dist/index.js"]);
  });

  it("labels containers with OSVA execution metadata", () => {
    const spec = buildDockerCreateContainerSpec(baseOptions, bridgeNetwork);
    expect(spec.Labels[OSVA_CONTAINER_MANAGED_LABEL]).toBe("true");
    expect(spec.Labels[OSVA_CONTAINER_EXECUTION_ID_LABEL]).toBe(
      "run-attempt-1",
    );
  });

  it("uses operator-controlled network mode for outbound capability access", () => {
    const spec = buildDockerCreateContainerSpec(baseOptions, {
      networkMode: "osva-runtime",
    });
    expect(spec.HostConfig.NetworkMode).toBe("osva-runtime");
  });

  it("captures stdout/stderr without stdin attach", () => {
    const spec = buildDockerCreateContainerSpec(baseOptions, bridgeNetwork);
    expect(spec.OpenStdin).toBe(false);
    expect(spec.AttachStdin).toBe(false);
    expect(spec.AttachStdout).toBe(true);
    expect(spec.AttachStderr).toBe(true);
    expect(spec.Tty).toBe(false);
  });

  it("injects bootstrap env vars without inheriting worker env", () => {
    const spec = buildDockerCreateContainerSpec(baseOptions, bridgeNetwork);
    expect(spec.Env).toEqual([
      "OSVA_EXECUTION_ID=run-attempt-1",
      "OSVA_RUNTIME_BOOTSTRAP_URL=http://host.docker.internal:8080/v1/runtime/executions/bootstrap?executionId=run-attempt-1",
      "OSVA_RUNTIME_BOOTSTRAP_TOKEN=bootstrap-token",
    ]);
  });

  it("enforces isolation restrictions on create configuration", () => {
    const host = buildDockerCreateContainerSpec(
      baseOptions,
      bridgeNetwork,
    ).HostConfig;

    expect(host.Privileged).toBe(false);
    expect(host.NetworkMode).not.toBe("host");
    expect(host.NetworkMode).not.toBe("none");
    expect(host.IpcMode).toBe("private");
    expect(host.PidMode).toBe("");
    expect(host.PortBindings).toEqual({});
    expect(host.PublishAllPorts).toBe(false);
    expect(host.Binds).toEqual([]);
    expect(host.Devices).toEqual([]);
    expect(host.RestartPolicy).toEqual({ Name: "no" });
    expect(host.ReadonlyRootfs).toBe(true);
    expect(host.CapDrop).toEqual(["ALL"]);
    expect(host.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(host.Tmpfs["/workspace"]).toBe("rw,noexec,nosuid,size=256m");
  });
});
