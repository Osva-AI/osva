import type {
  ArtifactId,
  ExecutionRequest,
  MemoryAuthorization,
  RunAttemptId,
  WorkspaceId,
} from "@osva/contracts";
import {
  ARTIFACT_ERROR_CODES,
  KNOWLEDGE_ERROR_CODES,
  MEMORY_ERROR_CODES,
  MODEL_ERROR_CODES,
  TOOL_ERROR_CODES,
} from "@osva/contracts";
import type {
  AgentRepository,
  RunRepository,
  RuntimeArtifactApplication,
} from "@osva/domain";
import type {
  RuntimeKnowledgeGateway,
  RuntimeMemoryGateway,
  RuntimeModelGateway,
  RuntimeToolGateway,
} from "@osva/observability";
import { createExecutionRequest } from "@osva/runtime-core";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteRequestSchema,
  runtimeMemoryDeleteRequestSchema,
  runtimeMemoryGetRequestSchema,
  runtimeMemoryListRequestSchema,
  runtimeMemorySetRequestSchema,
  runtimeKnowledgeSearchRequestSchema,
  runtimeModelGenerateTextRequestSchema,
  runtimeArtifactGetRequestSchema,
  runtimeToolInvokeRequestSchema,
} from "@osva/runtime-protocol";

import { mapArtifactDomainError } from "./artifact-errors.js";

import { RuntimeExecutionBootstrapStore } from "./execution-bootstrap-store.js";
import {
  verifyBootstrapToken,
  verifyCapabilityToken,
} from "./capability-token.js";
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
  readonly executionBootstrap?: RuntimeExecutionBootstrapStore;
  readonly clock?: RuntimeCapabilityBridgeClock;
  readonly logger?: RuntimeCapabilityBridgeLogger;
  readonly createScopedModelGateway: (
    execution: ExecutionRequest,
  ) => RuntimeModelGateway | undefined;
  readonly createScopedToolGateway: (
    execution: ExecutionRequest,
  ) => RuntimeToolGateway | undefined;
  readonly createScopedMemoryGateway: (
    execution: ExecutionRequest,
  ) => RuntimeMemoryGateway | undefined;
  readonly createScopedKnowledgeGateway: (
    execution: ExecutionRequest,
  ) => RuntimeKnowledgeGateway | undefined;
  readonly artifactApplication?: RuntimeArtifactApplication;
  readonly maxArtifactBytes?: number;
}

export class RuntimeCapabilityBridge {
  private readonly secret: string;
  private readonly runs: RunRepository;
  private readonly agents: AgentRepository;
  private readonly clock: RuntimeCapabilityBridgeClock;
  private readonly logger: RuntimeCapabilityBridgeLogger | undefined;
  private readonly createScopedModelGateway: RuntimeCapabilityBridgeOptions["createScopedModelGateway"];
  private readonly createScopedToolGateway: RuntimeCapabilityBridgeOptions["createScopedToolGateway"];
  private readonly createScopedMemoryGateway: RuntimeCapabilityBridgeOptions["createScopedMemoryGateway"];
  private readonly createScopedKnowledgeGateway: RuntimeCapabilityBridgeOptions["createScopedKnowledgeGateway"];
  private readonly executionBootstrap: RuntimeExecutionBootstrapStore;
  private readonly artifactApplication: RuntimeArtifactApplication | undefined;
  private readonly maxArtifactBytes: number | undefined;

  constructor(options: RuntimeCapabilityBridgeOptions) {
    this.secret = options.secret;
    this.runs = options.runs;
    this.agents = options.agents;
    this.executionBootstrap =
      options.executionBootstrap ?? new RuntimeExecutionBootstrapStore();
    this.clock = options.clock ?? { now: () => new Date() };
    this.logger = options.logger;
    this.createScopedModelGateway = options.createScopedModelGateway;
    this.createScopedToolGateway = options.createScopedToolGateway;
    this.createScopedMemoryGateway = options.createScopedMemoryGateway;
    this.createScopedKnowledgeGateway = options.createScopedKnowledgeGateway;
    this.artifactApplication = options.artifactApplication;
    this.maxArtifactBytes = options.maxArtifactBytes;
  }

  async authorizeCapabilityRequest(
    authorization: string | undefined,
    claimedExecutionId: string,
  ): Promise<
    | { readonly execution: ExecutionRequest; readonly error?: undefined }
    | {
        readonly execution?: undefined;
        readonly error: RuntimeCapabilityHttpResponse;
      }
  > {
    return this.authorize(authorization, claimedExecutionId);
  }

  handle: RuntimeCapabilityHttpHandler = async (request) => {
    return this.dispatch(request);
  };

  private async dispatch(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    if (request.pathname === RUNTIME_CAPABILITY_PATHS.executionBootstrap) {
      return this.handleExecutionBootstrap(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.generateText) {
      return this.handleGenerateText(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.invokeTool) {
      return this.handleInvokeTool(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.memoryGet) {
      return this.handleMemoryGet(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.memorySet) {
      return this.handleMemorySet(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.memoryDelete) {
      return this.handleMemoryDelete(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.memoryList) {
      return this.handleMemoryList(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.knowledgeSearch) {
      return this.handleKnowledgeSearch(request);
    }

    if (request.pathname === RUNTIME_CAPABILITY_PATHS.artifactGet) {
      return this.handleArtifactGet(request);
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

  private handleExecutionBootstrap(
    request: RuntimeCapabilityHttpRequest,
  ): RuntimeCapabilityHttpResponse {
    if (request.method !== "GET") {
      return jsonStatus(405, { status: "method_not_allowed" });
    }

    const executionId = request.searchParams.get("executionId")?.trim();
    if (executionId === undefined || executionId.length === 0) {
      return protocolInvalid("Execution bootstrap request is invalid.");
    }

    const token = bearerToken(request.authorization);
    if (token === undefined) {
      return unauthorized("Bootstrap credential is invalid.");
    }

    const claims = verifyBootstrapToken(this.secret, token, this.clock.now());
    if (claims === undefined) {
      return unauthorized("Bootstrap credential is invalid.");
    }

    if (claims.executionId !== executionId) {
      return forbidden("Bootstrap credential does not match this execution.");
    }

    const pending = this.executionBootstrap.consume(
      executionId,
      this.clock.now().getTime(),
    );
    if (pending === undefined) {
      return forbidden(
        "Bootstrap credential is outside its execution boundary.",
      );
    }

    const validated = runtimeExecuteRequestSchema.safeParse(pending);
    if (!validated.success) {
      return protocolInvalid("Execution bootstrap request is invalid.");
    }

    this.logger?.info("runtime.execution_bootstrap.delivered", {
      executionId,
    });

    return { status: 200, body: validated.data };
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

  private async handleMemoryGet(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeMemoryGetRequestSchema.safeParse(request.body);
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

    const gateway = this.createScopedMemoryGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory capability is unavailable.",
      );
    }

    try {
      const record = await gateway.get(
        {
          bindingName: parsed.data.bindingName,
          key: parsed.data.key,
        },
        memoryAuthorization(authorized.execution),
      );
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          record,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.memory_get_failed", error);
      const mapped = mapGatewayFailure(
        error,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory get failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleMemorySet(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeMemorySetRequestSchema.safeParse(request.body);
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

    const gateway = this.createScopedMemoryGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory capability is unavailable.",
      );
    }

    try {
      const record = await gateway.set(
        {
          bindingName: parsed.data.bindingName,
          key: parsed.data.key,
          value: parsed.data.value,
          expectedRevision: parsed.data.expectedRevision,
        },
        memoryAuthorization(authorized.execution),
      );
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          record,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.memory_set_failed", error);
      const mapped = mapGatewayFailure(
        error,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory set failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleMemoryDelete(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeMemoryDeleteRequestSchema.safeParse(request.body);
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

    const gateway = this.createScopedMemoryGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory capability is unavailable.",
      );
    }

    try {
      await gateway.delete(
        {
          bindingName: parsed.data.bindingName,
          key: parsed.data.key,
          expectedRevision: parsed.data.expectedRevision,
        },
        memoryAuthorization(authorized.execution),
      );
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.memory_delete_failed", error);
      const mapped = mapGatewayFailure(
        error,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory delete failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleArtifactGet(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeArtifactGetRequestSchema.safeParse(request.body);
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

    if (this.artifactApplication === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
        "Artifact capability is unavailable.",
      );
    }

    try {
      const artifact =
        await this.artifactApplication.getRuntimeArtifact.execute(
          parsed.data.artifactId as ArtifactId,
          {
            workspaceId: authorized.execution.workspaceId,
            runId: authorized.execution.runId,
            runAttemptId: authorized.execution.runAttemptId,
          },
        );
      this.logger?.info("runtime.capability.artifact_get_succeeded", {
        executionId: parsed.data.executionId,
        artifactId: artifact.id,
      });
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          artifact,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.artifact_get_failed", error);
      const mapped = mapArtifactDomainError(error);
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleMemoryList(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeMemoryListRequestSchema.safeParse(request.body);
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

    const gateway = this.createScopedMemoryGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory capability is unavailable.",
      );
    }

    try {
      const result = await gateway.list(
        {
          bindingName: parsed.data.bindingName,
          prefix: parsed.data.prefix,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor,
        },
        memoryAuthorization(authorized.execution),
      );
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          items: result.items,
          ...(result.nextCursor === undefined
            ? {}
            : { nextCursor: result.nextCursor }),
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.memory_list_failed", error);
      const mapped = mapGatewayFailure(
        error,
        MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
        "Memory list failed.",
      );
      return capabilityFailed(
        parsed.data.executionId,
        mapped.code,
        mapped.message,
      );
    }
  }

  private async handleKnowledgeSearch(
    request: RuntimeCapabilityHttpRequest,
  ): Promise<RuntimeCapabilityHttpResponse> {
    const parsed = runtimeKnowledgeSearchRequestSchema.safeParse(request.body);
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

    const gateway = this.createScopedKnowledgeGateway(authorized.execution);
    if (gateway === undefined) {
      return capabilityFailed(
        parsed.data.executionId,
        KNOWLEDGE_ERROR_CODES.KNOWLEDGE_UNAVAILABLE,
        "Knowledge capability is unavailable.",
      );
    }

    try {
      const hits = await gateway.search(parsed.data.bindingName, {
        query: parsed.data.query,
        topK: parsed.data.topK,
        filter: parsed.data.filter,
      });
      return {
        status: 200,
        body: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: parsed.data.executionId,
          outcome: "SUCCEEDED",
          hits,
        },
      };
    } catch (error) {
      this.logger?.error("runtime.capability.knowledge_search_failed", error);
      const mapped = mapKnowledgeGatewayFailure(error);
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

function memoryAuthorization(execution: ExecutionRequest): MemoryAuthorization {
  return {
    workspaceId: execution.workspaceId,
    memoryNamespaceBindings: execution.memoryNamespaceBindings,
    allowPersistentMutation: execution.evaluationContext === undefined,
  };
}

function mapKnowledgeGatewayFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  return mapGatewayFailure(
    error,
    KNOWLEDGE_ERROR_CODES.KNOWLEDGE_UNAVAILABLE,
    "Knowledge search failed.",
  );
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
