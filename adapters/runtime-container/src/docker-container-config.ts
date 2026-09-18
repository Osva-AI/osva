import type { ContainerNetworkConfig } from "./container-network.js";
import type { CreateContainerOptions } from "./container-engine.js";
import { formatContainerBootstrapEnv } from "./container-bootstrap-env.js";
import { CONTAINER_MINIMAL_ENV } from "./container-env.js";
import { osvaContainerLabels } from "./labels.js";

export const OSVA_CONTAINER_WORKSPACE_PATH = "/workspace" as const;

export interface DockerHostConfig {
  readonly AutoRemove: false;
  readonly Privileged: false;
  readonly NetworkMode: string;
  readonly IpcMode: "private";
  readonly PidMode: string;
  readonly PortBindings: Record<string, never>;
  readonly PublishAllPorts: false;
  readonly Binds: readonly [];
  readonly Devices: readonly [];
  readonly RestartPolicy: { readonly Name: "no" };
  readonly NanoCpus: number;
  readonly Memory: number;
  readonly PidsLimit: number;
  readonly ReadonlyRootfs: true;
  readonly CapDrop: readonly ["ALL"];
  readonly SecurityOpt: readonly ["no-new-privileges:true"];
  readonly Tmpfs: Readonly<Record<string, string>>;
}

export interface DockerCreateContainerSpec {
  readonly Image: string;
  readonly Cmd?: readonly string[];
  readonly Env: readonly string[];
  readonly Labels: Readonly<Record<string, string>>;
  readonly HostConfig: DockerHostConfig;
  readonly OpenStdin: false;
  readonly AttachStdin: false;
  readonly AttachStdout: true;
  readonly AttachStderr: true;
  readonly Tty: false;
}

export function cpuMillisToNanoCpus(cpuMillis: number): number {
  return cpuMillis * 1_000_000;
}

export function memoryMiBToBytes(memoryMiB: number): number {
  return memoryMiB * 1024 * 1024;
}

export function buildDockerCreateContainerSpec(
  options: CreateContainerOptions,
  network: ContainerNetworkConfig,
): DockerCreateContainerSpec {
  const spec: DockerCreateContainerSpec = {
    Image: options.image.image,
    Env: [
      ...CONTAINER_MINIMAL_ENV,
      ...formatContainerBootstrapEnv(options.bootstrap),
    ],
    Labels: osvaContainerLabels(options.executionId),
    HostConfig: {
      AutoRemove: false,
      Privileged: false,
      NetworkMode: network.networkMode,
      IpcMode: "private",
      PidMode: "",
      PortBindings: {},
      PublishAllPorts: false,
      Binds: [],
      Devices: [],
      RestartPolicy: { Name: "no" },
      NanoCpus: cpuMillisToNanoCpus(options.resources.cpuMillis),
      Memory: memoryMiBToBytes(options.resources.memoryMiB),
      PidsLimit: options.resources.pids,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=64m",
        [OSVA_CONTAINER_WORKSPACE_PATH]: "rw,noexec,nosuid,size=256m",
      },
    },
    OpenStdin: false,
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  };

  if (options.command !== undefined) {
    return {
      ...spec,
      Cmd: options.command,
    };
  }

  return spec;
}
