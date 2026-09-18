import type { ContainerExecutionBootstrapEnv } from "./container-bootstrap-env.js";
import type { ResolvedContainerResources } from "./resource-policy.js";

export interface ContainerEngineImageRef {
  readonly image: string;
}

export interface CreateContainerOptions {
  readonly executionId: string;
  readonly image: ContainerEngineImageRef;
  readonly command?: readonly string[];
  readonly resources: ResolvedContainerResources;
  readonly bootstrap: ContainerExecutionBootstrapEnv;
}

export interface ContainerEngineContainer {
  readonly id: string;
}

export interface RunContainerExecutionOptions {
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface ContainerEngineExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export class ContainerEngineTimeoutError extends Error {
  constructor(readonly containerId: string) {
    super(`Timed out waiting for container ${containerId}.`);
    this.name = "ContainerEngineTimeoutError";
  }
}

/**
 * Internal infrastructure seam for an OCI container engine.
 * This is not a public OSVA contract.
 */
export interface ContainerEngine {
  ensureImage(image: ContainerEngineImageRef): Promise<void>;
  createContainer(
    options: CreateContainerOptions,
  ): Promise<ContainerEngineContainer>;
  startContainer(container: ContainerEngineContainer): Promise<void>;
  runProtocolExecution(
    container: ContainerEngineContainer,
    options: RunContainerExecutionOptions,
  ): Promise<ContainerEngineExecutionResult>;
  stopContainer(container: ContainerEngineContainer): Promise<void>;
  killContainer(container: ContainerEngineContainer): Promise<void>;
  removeContainer(container: ContainerEngineContainer): Promise<void>;
  findExecutionContainer(
    executionId: string,
  ): Promise<ContainerEngineContainer | undefined>;
}
