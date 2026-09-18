import type {
  ContainerEngine,
  ContainerEngineContainer,
  ContainerEngineExecutionResult,
  ContainerEngineImageRef,
  CreateContainerOptions,
  RunContainerExecutionOptions,
} from "./container-engine.js";
import {
  assertAllowedContainerNetworkMode,
  type ContainerNetworkConfig,
} from "./container-network.js";
import type { DockerApiClient } from "./docker-api-client.js";
import { buildDockerCreateContainerSpec } from "./docker-container-config.js";
import { OSVA_CONTAINER_EXECUTION_ID_LABEL } from "./labels.js";

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

export interface DockerEngineAdapterOptions {
  readonly client: DockerApiClient;
  readonly network: ContainerNetworkConfig;
}

export class DockerEngineAdapter implements ContainerEngine {
  private readonly client: DockerApiClient;
  private readonly network: ContainerNetworkConfig;

  constructor(options: DockerEngineAdapterOptions) {
    assertAllowedContainerNetworkMode(options.network.networkMode);
    this.client = options.client;
    this.network = options.network;
  }

  async ensureImage(image: ContainerEngineImageRef): Promise<void> {
    try {
      await this.client.inspectImage(image.image);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      await this.client.pull(image.image);
    }
  }

  async createContainer(
    options: CreateContainerOptions,
  ): Promise<ContainerEngineContainer> {
    const created = await this.client.createContainer(
      buildDockerCreateContainerSpec(options, this.network),
    );
    return { id: created.Id };
  }

  async startContainer(container: ContainerEngineContainer): Promise<void> {
    await this.client.startContainer(container.id);
  }

  async runProtocolExecution(
    container: ContainerEngineContainer,
    options: RunContainerExecutionOptions,
  ): Promise<ContainerEngineExecutionResult> {
    const result = await this.client.runContainerProtocolExecution(
      container.id,
      {
        timeoutMs: options.timeoutMs,
        maxStdoutBytes: options.maxStdoutBytes,
        maxStderrBytes: options.maxStderrBytes,
      },
    );

    return {
      exitCode: result.StatusCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };
  }

  async stopContainer(container: ContainerEngineContainer): Promise<void> {
    await this.client.stopContainer(container.id);
  }

  async killContainer(container: ContainerEngineContainer): Promise<void> {
    await this.client.killContainer(container.id);
  }

  async removeContainer(container: ContainerEngineContainer): Promise<void> {
    await this.client.removeContainer(container.id);
  }

  async findExecutionContainer(
    executionId: string,
  ): Promise<ContainerEngineContainer | undefined> {
    const containers = await this.client.listContainersByLabel(
      OSVA_CONTAINER_EXECUTION_ID_LABEL,
      executionId,
    );
    const first = containers[0];
    if (first === undefined) {
      return undefined;
    }
    return { id: first.Id };
  }
}
