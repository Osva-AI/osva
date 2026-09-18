import type { DockerCreateContainerSpec } from "./docker-container-config.js";

export interface DockerContainerSummary {
  readonly Id: string;
}

export interface DockerRunContainerProtocolOptions {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface DockerRunContainerProtocolResult {
  readonly StatusCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

/**
 * Minimal Docker Engine API surface used by the adapter.
 * Keeps dockerode types inside the Docker adapter boundary.
 */
export interface DockerApiClient {
  ping(): Promise<void>;
  inspectImage(image: string): Promise<unknown>;
  pull(image: string): Promise<void>;
  createContainer(
    spec: DockerCreateContainerSpec,
  ): Promise<DockerContainerSummary>;
  startContainer(id: string): Promise<void>;
  runContainerProtocolExecution(
    id: string,
    options: DockerRunContainerProtocolOptions,
  ): Promise<DockerRunContainerProtocolResult>;
  stopContainer(id: string): Promise<void>;
  killContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  listContainersByLabel(
    label: string,
    value: string,
  ): Promise<readonly DockerContainerSummary[]>;
}
