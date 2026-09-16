import type {
  ExecutionRequest,
  RunAttemptId,
  WorkspaceId,
} from "@osva/contracts";
import { MODEL_ERROR_CODES, TOOL_ERROR_CODES } from "@osva/contracts";
import type { AgentRepository, RunRepository } from "@osva/domain";
import type {
  RuntimeModelGateway,
  RuntimeToolGateway,
} from "@osva/observability";
import { createExecutionRequest } from "@osva/runtime-core";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeModelGenerateTextRequestSchema,
  runtimeToolInvokeRequestSchema,
} from "@osva/runtime-protocol";

import { verifyCapabilityToken } from "./capability-token.js";
import type {
  RuntimeCapabilityHttpHandler,
  RuntimeCapabilityHttpRequest,
  RuntimeCapabilityHttpResponse,
} from "./capability-server.js";
import { sanitizePublicErrorMessage } from "./public-error.js";

export interface RuntimeCapabilityBridgeLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface RuntimeCapabilityBridgeClock {
  now(): Date;
}

export interface RuntimeCapabilityBridgeOptions {
  readonly secret: string;
  readonly runs: RunRepository;
  readonly agents: AgentRepository;
  readonly clock?: RuntimeCapabilityBridgeClock;
  readonly logger?: RuntimeCapabilityBridgeLogger;
  readonly createScopedModelGateway: (
    execution: ExecutionRequest,
  ) => RuntimeModelGateway | undefined;
  readonly createScopedToolGateway: (
    execution: ExecutionRequest,
  ) => RuntimeToolGateway | undefined;
}

export class RuntimeCapabilityBridge {
  private readonly secret: string;
  private readonly runs: RunRepository;
  private readonly agents: AgentRepository;
  private readonly clock: RuntimeCapabilityBridgeClock;
  private readonly logger: RuntimeCapabilityBridgeLogger | undefined;
  private readonly createScopedModelGateway: RuntimeCapabilityBridgeOptions["createScopedModelGateway"];
  private readonly createScopedToolGateway: RuntimeCapabilityBridgeOptions["createScopedToolGateway"];

  constructor(options: RuntimeCapabilityBridgeOptions) {
    this.secret = options.secret;
    this.runs = options.runs;
    this.agents = options.agents;
    this.clock = options.clock ?? { now: () => new Date() };
    this.logger = options.logger;
    this.createScopedModelGateway = options.createScopedModelGateway;
    this.createScopedToolGateway = options.createScopedToolGateway;
  }

  handle: RuntimeCapabilityHttpHandler = async (request) => {
    return this.dispatch(request);
  };

  private async dispatch(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    if (request.pathname === RUNTIME_CAPABILITY_PATHS.generateText) {
      return this.handleGenerateText(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.invokeTool) {
      return this.handleInvokeTool(request);
    }

    return jsonStatus(404, {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      outcome: "FAILED",
      error: {
        code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        message: "Unknown capability path.",
      },
    });
  }

  private async handleGenerateText(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeModelGenerateTextRequestSchema.safeParse(
      request.body,
    );
    if (!parsed.success) {
      return protocolInvalid("Capability request is invalid.");
    }

    const authorized = await this.authorize(
      request.authorization,
      parsed.data.executionId,
    );
    if (authorized.error !== undefined) {
      return authorized.error;
    }

    const modelProfileVersionId =
      authorized.execution.modelProfileVersionBindings[parsed.data.bindingName];
    if (modelProfileVersionId === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MODEL_ERROR_CODES.MODEL_BINDING_NOT_FOUND,
        "Model binding was not found.",
      );
    }

    const gateway = this.createScopedModelGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
        "The configured model provider is unavailable.",
      );
    }

    try {
      const result = await gateway.generateText({
        modelProfileVersionId,
        messages: parsed.data.input.messages,
        maxOutputTokens: parsed.data.input.maxOutputTokens,
      });
      this.logger?.info("runtime.capability.model_succeeded", {
        executionId: parsed.data.executionId,
        bindingName: parsed.data.bindingName,
      });
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          result,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.model_failed", error);
      const mapped = mapGatewayFailure(
        error,
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "Model generation failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleInvokeTool(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeToolInvokeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return protocolInvalid("Capability request is invalid.");
    }

    const authorized = await this.authorize(
      request.authorization,
      parsed.data.executionId,
    );
    if (authorized.error !== undefined) {
      return authorized.error;
    }

    const toolVersionId =
      authorized.execution.toolVersionBindings[parsed.data.bindingName];
    if (toolVersionId === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
        "Tool binding was not found.",
      );
    }

    const gateway = this.createScopedToolGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR,
        "Tool capability is unavailable.",
      );
    }

    try {
      const output = await gateway.invoke({
        toolVersionId,
        input: parsed.data.input,
        idempotencyKey: parsed.data.idempotencyKey,
        authorization: {
          workspaceId: authorized.execution.workspaceId,
          agentId: authorized.execution.agentId,
          runId: authorized.execution.runId,
          runAttemptId: authorized.execution.runAttemptId,
          bindingName: parsed.data.bindingName,
          toolVersionId,
        },
      });
      this.logger?.info("runtime.capability.tool_succeeded", {
        executionId: parsed.data.executionId,
        bindingName: parsed.data.bindingName,
      });
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          output,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.tool_failed", error);
      const mapped = mapGatewayFailure(
        error,
        TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR,
        "Tool invocation failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async authorize(
    authorization: string | undefined,
    claimedExecutionId: string,
  ): Promise<
    | { readonly execution: ExecutionRequest; readonly error?: undefined }
    | {
        readonly execution?: undefined;
        readonly error: RuntimeCapabilityHttpResponse;
      }
  > {
    const token = bearerToken(authorization);
    if (token === undefined) {
      return { error: unauthorized("Capability credential is invalid.") };
    }

    const claims = verifyCapabilityToken(this.secret, token, this.clock.now());
    if (claims === undefined) {
      return { error: unauthorized("Capability credential is invalid.") };
    }

    if (claims.executionId !== claimedExecutionId) {
      return {
        error: forbidden(
          "Capability credential does not match this execution.",
        ),
      };
    }

    const attempt = await this.runs.findRunAttemptById(
      claimedExecutionId as RunAttemptId,
    );
    if (attempt === null || attempt.status !== "RUNNING") {
      return {
        error: forbidden(
          "Capability credential is outside its execution boundary.",
        ),
      };
    }

    const run = await this.runs.findRunById(attempt.runId);
    if (run === null || run.id !== claims.runId) {
      return {
        error: forbidden(
          "Capability credential does not match this execution.",
        ),
      };
    }

    if (run.workspaceId !== (claims.workspaceId as WorkspaceId)) {
      return {
        error: forbidden(
          "Capability credential does not match this workspace.",
        ),
      };
    }

    const agentVersion = await this.agents.findAgentVersionById(
      run.effectiveBindings.agentVersionId,
    );
    if (agentVersion === null) {
      return {
        error: forbidden(
          "Capability credential is outside its execution boundary.",
        ),
      };
    }

    return {
      execution: createExecutionRequest({
        run,
        runAttempt: attempt,
        agentVersion,
      }),
    };
  }
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = match?.[1];
  return token === undefined || token.length === 0 ? undefined : token;
}

function jsonStatus(
  status: number,
  body: unknown,
): RuntimeCapabilityHttpResponse {
  return { status, body };
}

function protocolInvalid(message: string): RuntimeCapabilityHttpResponse {
  return jsonStatus(400, {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    outcome: "FAILED",
    error: {
      code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
      message,
    },
  });
}

function unauthorized(message: string): RuntimeCapabilityHttpResponse {
  return jsonStatus(401, {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    outcome: "FAILED",
    error: {
      code: RUNTIME_PROTOCOL_ERROR_CODES.CAPABILITY_UNAUTHORIZED,
      message,
    },
  });
}

function forbidden(message: string): RuntimeCapabilityHttpResponse {
  return jsonStatus(403, {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    outcome: "FAILED",
    error: {
      code: RUNTIME_PROTOCOL_ERROR_CODES.CAPABILITY_UNAUTHORIZED,
      message,
    },
  });
}

function capabilityFailed(
  executionId: string,
  code: string,
  message: string,
): RuntimeCapabilityHttpResponse {
  return jsonStatus(200, {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    executionId,
    outcome: "FAILED",
    error: {
      code,
      message: sanitizePublicErrorMessage(
        message,
        "Capability invocation failed.",
      ),
    },
  });
}

function mapGatewayFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): { readonly code: string; readonly message: string } {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return {
      code: error.code,
      message: sanitizePublicErrorMessage(message, fallbackMessage),
    };
  }

  return { code: fallbackCode, message: fallbackMessage };
}
