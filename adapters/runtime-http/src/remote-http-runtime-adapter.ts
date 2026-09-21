import type {
  ExecutionRequest,
  ExecutionResult,
  JsonValue,
  RemoteHttpRuntime,
  RuntimeAdapter,
  SecretResolver,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";
import { toRuntimeExecutionId } from "@osva/runtime-core";
import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_MAX_BODY_BYTES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteResponseSchema,
  type RuntimeExecuteRequest,
} from "@osva/runtime-protocol";

import {
  CAPABILITY_TOKEN_SKEW_MS,
  issueCapabilityToken,
} from "./capability-token.js";
import { OversizedBodyError } from "./errors.js";
import { isJsonContentType, readLimitedFetchBody } from "./limited-body.js";
import {
  REMOTE_HTTP_FORBIDDEN_DESTINATION_MESSAGE,
  resolveRemoteHttpConnectionTarget,
  type HostnameLookup,
} from "@osva/outbound-network";
import {
  fetchWithPinnedConnection,
  type PinnedFetchInit,
  type PinnedRemoteHttpConnection,
} from "@osva/outbound-network";
import {
  executionFailure,
  sanitizePublicErrorMessage,
} from "./public-error.js";

export interface RemoteHttpRuntimeLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface RemoteHttpRuntimeClock {
  now(): Date;
}

export interface RemoteHttpRuntimeAdapterOptions {
  readonly secretResolver: SecretResolver;
  readonly getCapabilityBaseUrl: () => string | undefined;
  readonly capabilitySecret: string;
  /**
   * Operator-controlled opt-in for private/loopback/link-local destinations.
   * AgentVersion, Run input, and workflow input cannot enable this.
   */
  readonly allowPrivateNetworks?: boolean;
  readonly lookup?: HostnameLookup;
  readonly clock?: RemoteHttpRuntimeClock;
  readonly pinnedFetch?: (
    connection: PinnedRemoteHttpConnection,
    init: PinnedFetchInit,
  ) => Promise<Response>;
  readonly logger?: RemoteHttpRuntimeLogger;
}

/**
 * Synchronous Runtime Protocol V1 HTTP executor.
 * One execute() call performs exactly one POST; it never retries.
 */
export class RemoteHttpRuntimeAdapter implements RuntimeAdapter {
  private readonly secretResolver: SecretResolver;
  private readonly getCapabilityBaseUrl: () => string | undefined;
  private readonly capabilitySecret: string;
  private readonly allowPrivateNetworks: boolean;
  private readonly lookup: HostnameLookup | undefined;
  private readonly clock: RemoteHttpRuntimeClock;
  private readonly pinnedFetch: (
    connection: PinnedRemoteHttpConnection,
    init: PinnedFetchInit,
  ) => Promise<Response>;
  private readonly logger: RemoteHttpRuntimeLogger | undefined;

  constructor(options: RemoteHttpRuntimeAdapterOptions) {
    this.secretResolver = options.secretResolver;
    this.getCapabilityBaseUrl = options.getCapabilityBaseUrl;
    this.capabilitySecret = options.capabilitySecret;
    this.allowPrivateNetworks = options.allowPrivateNetworks === true;
    this.lookup = options.lookup;
    this.clock = options.clock ?? { now: () => new Date() };
    this.pinnedFetch = options.pinnedFetch ?? fetchWithPinnedConnection;
    this.logger = options.logger;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (request.runtime.type !== "REMOTE_HTTP") {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote HTTP executor received a non-REMOTE_HTTP runtime binding.",
      );
    }

    const runtime = request.runtime;
    const executionId = toRuntimeExecutionId(request.runAttemptId);
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

    let connectionTarget: Awaited<
      ReturnType<typeof resolveRemoteHttpConnectionTarget>
    >;
    try {
      connectionTarget = await resolveRemoteHttpConnectionTarget(
        runtime.endpoint,
        {
          allowPrivateNetworks: this.allowPrivateNetworks,
          lookup: this.lookup,
        },
      );
    } catch (error) {
      return this.transportFailure(error);
    }

    if (connectionTarget.kind === "invalid_endpoint") {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime endpoint is not a valid http(s) URL.",
      );
    }

    if (connectionTarget.kind === "forbidden_destination") {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
        REMOTE_HTTP_FORBIDDEN_DESTINATION_MESSAGE,
      );
    }

    const timeoutMs = runtime.timeoutMs ?? request.timeoutMs;
    let authorization: string | undefined;
    try {
      authorization = await this.resolveAuthorization(runtime);
    } catch {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime authentication secret was not found.",
      );
    }

    const token = issueCapabilityToken(this.capabilitySecret, {
      executionId,
      workspaceId: request.workspaceId,
      runId: request.runId,
      exp: this.clock.now().getTime() + timeoutMs + CAPABILITY_TOKEN_SKEW_MS,
    });

    const payload: RuntimeExecuteRequest = {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId,
      input: request.input,
      capabilities: {
        endpoint: capabilityBaseUrl,
        token,
      },
    };

    this.logger?.info("runtime.remote_http.execute_started", {
      executionId,
      host: hostOf(runtime.endpoint),
    });

    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await this.pinnedFetch(
        {
          url: connectionTarget.url,
          hostname: connectionTarget.hostname,
          address: connectionTarget.pinnedAddress,
        },
        {
          method: "POST",
          signal: abort.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(authorization === undefined ? {} : { authorization }),
          },
          body: JSON.stringify(payload),
        },
      );
    } catch (error) {
      clearTimeout(timer);
      return this.transportFailure(error);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
        "Remote runtime redirected the execution request.",
      );
    }

    if (response.status < 200 || response.status >= 300) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
        `Remote runtime returned HTTP ${String(response.status)}.`,
      );
    }

    if (!isJsonContentType(response.headers.get("content-type"))) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime returned a non-JSON content type.",
      );
    }

    let raw: Buffer;
    try {
      raw = await readLimitedFetchBody(
        response,
        RUNTIME_PROTOCOL_MAX_BODY_BYTES,
      );
    } catch (error) {
      if (error instanceof OversizedBodyError) {
        return executionFailure(
          RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
          "Remote runtime response exceeds the maximum body size.",
        );
      }
      return this.transportFailure(error);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString("utf8"));
    } catch {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime returned invalid JSON.",
      );
    }

    const parsed = runtimeExecuteResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime returned an invalid protocol response.",
      );
    }

    if (parsed.data.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime returned an unsupported protocol version.",
      );
    }

    if (parsed.data.executionId !== executionId) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        "Remote runtime returned a mismatched executionId.",
      );
    }

    if (parsed.data.outcome === "FAILED") {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED,
        sanitizePublicErrorMessage(
          parsed.data.error.message,
          "Remote agent execution failed.",
        ),
      );
    }

    return { status: "succeeded", output: parsed.data.output };
  }

  private async resolveAuthorization(
    runtime: RemoteHttpRuntime,
  ): Promise<string | undefined> {
    if (runtime.authSecretRef === undefined) {
      return undefined;
    }

    const secret = await this.secretResolver.resolve(runtime.authSecretRef);
    return `Bearer ${secret}`;
  }

  private transportFailure(error: unknown): ExecutionResult {
    if (isAbortError(error)) {
      return executionFailure(
        RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
        "Remote runtime execution timed out.",
      );
    }

    return executionFailure(
      RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
      "Remote runtime transport failed.",
    );
  }
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

export type { JsonValue };
