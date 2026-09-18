import {
  buildRuntimeExecutionBootstrapUrl,
  CAPABILITY_TOKEN_SKEW_MS,
  issueBootstrapToken,
  issueCapabilityToken,
  type RuntimeExecutionBootstrapStore,
} from "@osva/adapters-runtime-http";
import type {
  ContainerRuntime,
  ExecutionRequest,
  ExecutionResult,
  RuntimeAdapter,
} from "@osva/contracts";
import {
  isCanonicalJsonValue,
  isDigestPinnedOciImageReference,
} from "@osva/contracts";
import { toRuntimeExecutionId } from "@osva/runtime-core";
import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeExecuteRequest,
} from "@osva/runtime-protocol";

import type {
  ContainerEngine,
  ContainerEngineContainer,
} from "./container-engine.js";
import {
  ContainerProtocolParseError,
  parseContainerProtocolStdout,
  protocolFailureCode,
  protocolFailureMessage,
} from "./protocol-io.js";
import {
  CONTAINER_PROTOCOL_STDERR_MAX_BYTES,
  CONTAINER_PROTOCOL_STDOUT_MAX_BYTES,
} from "./output-limits.js";
import {
  executionFailure,
  sanitizePublicErrorMessage,
} from "./public-error.js";
import {
  resolveContainerResources,
  type ContainerResourcePolicy,
} from "./resource-policy.js";
import { DockerContainerEngineOperationError } from "./docker-engine-errors.js";

export const CONTAINER_STOP_GRACE_MS = 2_000;

export interface ContainerRuntimeLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface ContainerRuntimeClock {
  now(): Date;
}

export interface ContainerRuntimeAdapterOptions {
  readonly engine: ContainerEngine;
  readonly resourcePolicy: ContainerResourcePolicy;
  readonly getCapabilityBaseUrl: () => string | undefined;
  readonly capabilitySecret: string;
  readonly executionBootstrap: RuntimeExecutionBootstrapStore;
  readonly clock?: ContainerRuntimeClock;
  readonly logger?: ContainerRuntimeLogger;
  readonly stopGraceMs?: number;
}

export class ContainerRuntimeAdapter implements RuntimeAdapter {
  private readonly engine: ContainerEngine;
  private readonly resourcePolicy: ContainerResourcePolicy;
  private readonly getCapabilityBaseUrl: () => string | undefined;
  private readonly capabilitySecret: string;
  private readonly executionBootstrap: RuntimeExecutionBootstrapStore;
  private readonly clock: ContainerRuntimeClock;
  private readonly logger: ContainerRuntimeLogger | undefined;
  private readonly stopGraceMs: number;
  private readonly activeExecutions = new Map<
    string,
    ContainerEngineContainer
  >();

  constructor(options: ContainerRuntimeAdapterOptions) {
    this.engine = options.engine;
    this.resourcePolicy = options.resourcePolicy;
    this.getCapabilityBaseUrl = options.getCapabilityBaseUrl;
    this.capabilitySecret = options.capabilitySecret;
    this.executionBootstrap = options.executionBootstrap;
    this.clock = options.clock ?? { now: () => new Date() };
    this.logger = options.logger;
    this.stopGraceMs = options.stopGraceMs ?? CONTAINER_STOP_GRACE_MS;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (request.runtime.type !== "CONTAINER") {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Container executor received a non-CONTAINER runtime binding.",
      );
    }

    const runtime = request.runtime;
    const executionId = toRuntimeExecutionId(request.runAttemptId);

    if (!isDigestPinnedOciImageReference(runtime.image)) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Container runtime image must be a digest-pinned OCI reference.",
      );
    }

    if (!isCanonicalJsonValue(request.input)) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Runtime input is not JSON-compatible.",
      );
    }

    const capabilityBaseUrl = this.getCapabilityBaseUrl()?.replace(/\/$/, "");
    if (capabilityBaseUrl === undefined || capabilityBaseUrl.length === 0) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Runtime capability bridge is not configured.",
      );
    }

    if (this.capabilitySecret.trim().length === 0) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Runtime capability bridge is not configured.",
      );
    }

    let resources;
    try {
      resources = resolveContainerResources(
        this.resourcePolicy,
        runtime.resources,
      );
    } catch (error) {
      return this.resourceFailure(error);
    }

    const expiresAtMs =
      this.clock.now().getTime() + request.timeoutMs + CAPABILITY_TOKEN_SKEW_MS;

    const capabilityToken = issueCapabilityToken(this.capabilitySecret, {
      executionId,
      workspaceId: request.workspaceId,
      runId: request.runId,
      exp: expiresAtMs,
    });

    const payload: RuntimeExecuteRequest = {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId,
      input: request.input,
      capabilities: {
        endpoint: capabilityBaseUrl,
        token: capabilityToken,
      },
    };

    const bootstrapToken = issueBootstrapToken(this.capabilitySecret, {
      executionId,
      exp: expiresAtMs,
    });

    const bootstrapUrl = buildRuntimeExecutionBootstrapUrl(
      capabilityBaseUrl,
      executionId,
    );

    this.executionBootstrap.register(executionId, payload, expiresAtMs);

    this.logger?.info("runtime.container.execute_started", {
      executionId,
      runtimeType: runtime.type,
      image: runtime.image,
    });

    await this.removeStaleExecutionContainer(executionId);

    try {
      await this.engine.ensureImage({ image: runtime.image });
    } catch (error) {
      return this.transportFailure(
        error,
        "Container runtime failed to prepare image.",
      );
    }

    let container: ContainerEngineContainer | undefined;
    try {
      container = await this.engine.createContainer({
        executionId,
        image: { image: runtime.image },
        command: runtime.command,
        resources,
        bootstrap: {
          executionId,
          bootstrapUrl,
          bootstrapToken,
        },
      });
    } catch (error) {
      return this.transportFailure(
        error,
        "Container runtime failed to create execution container.",
      );
    }

    this.activeExecutions.set(executionId, container);
    try {
      const engineResult = await this.engine.runProtocolExecution(container, {
        timeoutMs: request.timeoutMs,
        maxStdoutBytes: CONTAINER_PROTOCOL_STDOUT_MAX_BYTES,
        maxStderrBytes: CONTAINER_PROTOCOL_STDERR_MAX_BYTES,
      });

      let parsed;
      try {
        parsed = parseContainerProtocolStdout(
          engineResult.stdout,
          executionId,
          {
            stdoutByteLength: engineResult.stdoutBytes,
            stdoutTruncated: engineResult.stdoutTruncated,
          },
        );
      } catch (error) {
        if (error instanceof ContainerProtocolParseError) {
          if (engineResult.exitCode === 0) {
            return executionFailure(
              protocolFailureCode(),
              protocolFailureMessage(error.reason),
            );
          }

          return executionFailure(
            RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
            engineResult.stderr.trim().length > 0
              ? sanitizePublicErrorMessage(
                  engineResult.stderr,
                  "Container runtime execution failed.",
                )
              : `Container runtime exited with status ${String(engineResult.exitCode)}.`,
          );
        }
        throw error;
      }

      if (parsed.response.outcome === "FAILED") {
        return executionFailure(
          RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED,
          sanitizePublicErrorMessage(
            parsed.response.error.message,
            "Container agent execution failed.",
          ),
        );
      }

      return { status: "succeeded", output: parsed.response.output };
    } catch (error) {
      if (isTimeoutError(error)) {
        await this.forceTerminateContainer(container);
        return executionFailure(
          RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
          "Container runtime execution timed out.",
        );
      }

      await this.forceTerminateContainer(container);
      return this.transportFailure(
        error,
        "Container runtime execution failed.",
      );
    } finally {
      this.executionBootstrap.clear(executionId);
      this.activeExecutions.delete(executionId);
      await this.cleanupContainer(container);
      this.logger?.info("runtime.container.execute_finished", {
        executionId,
        runtimeType: runtime.type,
      });
    }
  }

  async close(): Promise<void> {
    const active = [...this.activeExecutions.entries()];
    this.activeExecutions.clear();
    for (const [executionId, container] of active) {
      this.logger?.info("runtime.container.close_terminating", { executionId });
      await this.forceTerminateContainer(container);
      await this.cleanupContainer(container);
    }
  }

  private async removeStaleExecutionContainer(
    executionId: string,
  ): Promise<void> {
    const stale = await this.engine.findExecutionContainer(executionId);
    if (stale === undefined) {
      return;
    }

    this.logger?.info("runtime.container.stale_removed", { executionId });
    await this.forceTerminateContainer(stale);
    await this.cleanupContainer(stale);
  }

  private async cleanupContainer(
    container: ContainerEngineContainer | undefined,
  ): Promise<void> {
    if (container === undefined) {
      return;
    }

    try {
      await this.engine.stopContainer(container);
    } catch {
      // Best-effort cleanup.
    }

    try {
      await this.engine.removeContainer(container);
    } catch {
      // Best-effort cleanup.
    }
  }

  private async forceTerminateContainer(
    container: ContainerEngineContainer,
  ): Promise<void> {
    try {
      await this.engine.stopContainer(container);
    } catch {
      // Continue to kill.
    }

    await sleep(this.stopGraceMs);

    try {
      await this.engine.killContainer(container);
    } catch {
      // Best-effort cleanup.
    }
  }

  private resourceFailure(error: unknown): ExecutionResult {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "CONTAINER_RESOURCE_EXCEEDS_MAX"
    ) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        error.message,
      );
    }

    return executionFailure(
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
      "Container runtime resource policy rejected the execution request.",
    );
  }

  private transportFailure(error: unknown, message: string): ExecutionResult {
    if (isTimeoutError(error)) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
        "Container runtime execution timed out.",
      );
    }

    this.logger?.error("runtime.container.transport_failure", error);
    if (error instanceof DockerContainerEngineOperationError) {
      this.logger?.info("runtime.container.transport_failure_operation", {
        dockerOperation: error.operation,
        containerId: error.containerId,
      });
    }
    return executionFailure(
      RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
      message,
    );
  }
}

function isTimeoutError(error: unknown): boolean {
  if (
    error instanceof Error &&
    error.name === "DockerContainerExecutionTimeoutError"
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    /timed out waiting for container/i.test(error.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type { ContainerRuntime };
