import { Readable } from "node:stream";

import Docker from "dockerode";

import type {
  DockerApiClient,
  DockerRunContainerProtocolOptions,
  DockerRunContainerProtocolResult,
  DockerContainerSummary,
} from "./docker-api-client.js";
import type { DockerCreateContainerSpec } from "./docker-container-config.js";
import {
  DockerContainerEngineOperationError,
  DockerContainerExecutionTimeoutError,
} from "./docker-engine-errors.js";
import { readDemuxedDockerStream } from "./docker-stream.js";

export {
  DockerContainerEngineOperationError,
  DockerContainerExecutionTimeoutError,
} from "./docker-engine-errors.js";

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

function isAlreadyStartedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 304
  );
}

function mapContainer(container: { id: string }): DockerContainerSummary {
  return { Id: container.id };
}

export interface CreateDockerodeClientOptions {
  readonly socketPath?: string;
}

export function createDockerodeClient(
  options: CreateDockerodeClientOptions = {},
): DockerApiClient {
  const docker = new Docker(
    options.socketPath === undefined
      ? undefined
      : { socketPath: options.socketPath },
  );

  return {
    async ping(): Promise<void> {
      await docker.ping();
    },

    async inspectImage(image: string): Promise<unknown> {
      return docker.getImage(image).inspect();
    },

    async pull(image: string): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        docker.pull(
          image,
          (error: Error | null, stream: NodeJS.ReadableStream) => {
            if (error !== null) {
              reject(error);
              return;
            }

            docker.modem.followProgress(stream, (progressError) => {
              if (progressError !== null) {
                reject(progressError);
                return;
              }
              resolve();
            });
          },
        );
      });
    },

    async createContainer(
      spec: DockerCreateContainerSpec,
    ): Promise<DockerContainerSummary> {
      const container = await docker.createContainer({
        ...spec,
        Cmd: spec.Cmd === undefined ? undefined : [...spec.Cmd],
        Env: [...spec.Env],
        HostConfig: {
          ...spec.HostConfig,
          CapDrop: [...spec.HostConfig.CapDrop],
          SecurityOpt: [...spec.HostConfig.SecurityOpt],
          Binds: [...spec.HostConfig.Binds],
          Devices: [...spec.HostConfig.Devices],
          Tmpfs: { ...spec.HostConfig.Tmpfs },
        },
      });
      return mapContainer(container);
    },

    async startContainer(id: string): Promise<void> {
      const container = docker.getContainer(id);
      try {
        await container.start();
      } catch (error) {
        if (!isAlreadyStartedError(error)) {
          throw error;
        }
      }
    },

    async runContainerProtocolExecution(
      id: string,
      options: DockerRunContainerProtocolOptions,
    ): Promise<DockerRunContainerProtocolResult> {
      const container = docker.getContainer(id);
      const timeoutError = new DockerContainerExecutionTimeoutError(id);
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const executionPromise = (async () => {
        try {
          await this.startContainer(id);
        } catch (error) {
          throw new DockerContainerEngineOperationError("start", id, error);
        }

        let waitResult: { StatusCode?: number };
        try {
          waitResult = await container.wait();
        } catch (error) {
          throw new DockerContainerEngineOperationError("wait", id, error);
        }

        try {
          const logStream = await container.logs({
            stdout: true,
            stderr: true,
            timestamps: false,
          });
          const logReadable = Buffer.isBuffer(logStream)
            ? Readable.from(logStream)
            : logStream;
          const output = await readDemuxedDockerStream(logReadable, {
            maxStdoutBytes: options.maxStdoutBytes,
            maxStderrBytes: options.maxStderrBytes,
          });
          return {
            StatusCode: waitResult.StatusCode ?? -1,
            stdout: output.stdout,
            stderr: output.stderr,
            stdoutBytes: output.stdoutBytes,
            stderrBytes: output.stderrBytes,
            stdoutTruncated: output.stdoutTruncated,
            stderrTruncated: output.stderrTruncated,
          };
        } catch (error) {
          if (error instanceof DockerContainerEngineOperationError) {
            throw error;
          }
          throw new DockerContainerEngineOperationError("logs", id, error);
        }
      })();

      void executionPromise.catch(() => {
        // Timeout may win the race while executionPromise is still draining.
      });

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            reject(timeoutError);
          }, options.timeoutMs);
        });

        return await Promise.race([executionPromise, timeoutPromise]);
      } catch (error) {
        if (timedOut) {
          try {
            await container.kill();
          } catch (killError) {
            if (!isNotFoundError(killError)) {
              throw killError;
            }
          }
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    },

    async stopContainer(id: string): Promise<void> {
      const container = docker.getContainer(id);
      try {
        await container.stop();
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },

    async killContainer(id: string): Promise<void> {
      const container = docker.getContainer(id);
      try {
        await container.kill();
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },

    async removeContainer(id: string): Promise<void> {
      const container = docker.getContainer(id);
      try {
        await container.remove({ force: true });
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },

    async listContainersByLabel(
      label: string,
      value: string,
    ): Promise<readonly DockerContainerSummary[]> {
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: [`${label}=${value}`],
        },
      });
      return containers.map((container) => ({ Id: container.Id }));
    },
  };
}

export async function createDockerodeClientFromEnv(): Promise<DockerApiClient> {
  return createDockerodeClient();
}
