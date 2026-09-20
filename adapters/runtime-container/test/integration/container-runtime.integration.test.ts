import {
  MemoryAgentRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import {
  RuntimeCapabilityBridge,
  RuntimeExecutionBootstrapStore,
  startRuntimeCapabilityServer,
} from "@osva/adapters-runtime-http";
import type {
  ExecutionRequest,
  RunAttemptId,
  RunId,
  ToolVersionId,
} from "@osva/contracts";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  Run,
  RunAttempt,
} from "@osva/domain";
import type { RuntimeToolGateway } from "@osva/observability";
import { RUNTIME_PROTOCOL_ERROR_CODES } from "@osva/runtime-protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ContainerRuntimeAdapter,
  DockerEngineAdapter,
  createDockerodeClient,
  DEFAULT_CONTAINER_RESOURCE_POLICY,
  suggestContainerCapabilityBaseUrl,
} from "../../src/index.js";
import type { RuntimeCapabilityServer } from "@osva/adapters-runtime-http";
import { buildRuntimeExecutionBootstrapUrl } from "@osva/adapters-runtime-http";

import type { DockerApiClient } from "../../src/docker-api-client.js";

import {
  assertNoOsvaManagedContainers,
  buildExampleContainerImage,
  createLocalImageAliasingDockerClient,
  isDockerAvailable,
  listOsvaManagedContainers,
  type ExampleContainerImageFixture,
} from "./docker-harness.js";

const CAPABILITY_SECRET = "container-integration-secret";
const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");
const toolVersionId = "tv-1" as ToolVersionId;
const dockerAvailable = isDockerAvailable();

function containerRequest(
  image: string,
  input: unknown,
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  const runAttemptId =
    overrides.runAttemptId ?? ("run-attempt-1" as RunAttemptId);
  const runId = `run-${runAttemptId}` as RunId;
  return {
    runId: overrides.runId ?? runId,
    runAttemptId,
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "agent-version-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "CONTAINER",
      protocolVersion: "1",
      image,
    },
    input,
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolVersionBindings: { echo: toolVersionId },
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    timeoutMs: 15_000,
    policyContext: {},
    ...overrides,
  };
}

describe.skipIf(!dockerAvailable)(
  "container runtime Docker integration",
  () => {
    let exampleImage: ExampleContainerImageFixture;
    let dockerClient: DockerApiClient;
    let capabilityOrigin = "";
    let capabilityServer: RuntimeCapabilityServer | undefined;
    let bootstrapStore: RuntimeExecutionBootstrapStore;
    let runs: MemoryRunRepository;
    let agents: MemoryAgentRepository;

    beforeAll(async () => {
      exampleImage = await buildExampleContainerImage();
      dockerClient = createLocalImageAliasingDockerClient({
        delegate: createDockerodeClient(),
        runtimeImageReference: exampleImage.runtimeImageReference,
        localDockerImage: exampleImage.localDockerImage,
      });
      bootstrapStore = new RuntimeExecutionBootstrapStore();
      runs = new MemoryRunRepository();
      agents = new MemoryAgentRepository();

      await agents.saveAgent(
        Agent.create({
          id: "agent-1" as never,
          workspaceId: "ws-1" as never,
          key: "container-agent",
          name: "Container Agent",
          createdAt: NOW,
        }),
      );
      await agents.saveAgentVersion(
        AgentVersion.create({
          id: "agent-version-1" as never,
          agentId: "agent-1" as never,
          version: 1,
          manifest: {
            schemaVersion: "1",
            key: "container-agent",
            name: "Container Agent",
            runtime: {
              type: "CONTAINER",
              protocolVersion: "1",
              image: exampleImage.runtimeImageReference,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 5_000, maxAttempts: 1 },
            capabilities: { model: false, tools: ["echo"] },
            models: {},
            tools: { echo: { toolVersionId } },
          },
          createdAt: NOW,
        }),
      );

      const mockToolGateway: RuntimeToolGateway = {
        invoke: async () => ({ echoed: true }),
      };

      const bridge = new RuntimeCapabilityBridge({
        secret: CAPABILITY_SECRET,
        runs,
        agents,
        executionBootstrap: bootstrapStore,
        clock: { now: () => new Date() },
        createScopedModelGateway: () => undefined,
        createScopedToolGateway: () => mockToolGateway,
        createScopedMemoryGateway: () => undefined,
        createScopedKnowledgeGateway: () => undefined,
      });

      capabilityServer = await startRuntimeCapabilityServer({
        host: "0.0.0.0",
        handler: bridge.handle,
      });
      capabilityOrigin = suggestContainerCapabilityBaseUrl(
        capabilityServer.port,
      );
    });

    afterEach(async () => {
      await assertNoOsvaManagedContainers();
    });

    afterAll(async () => {
      if (capabilityServer !== undefined) {
        await capabilityServer.close();
      }
      await assertNoOsvaManagedContainers();
    });

    async function seedRunningExecution(
      runAttemptId: RunAttemptId,
      runId: RunId,
    ): Promise<void> {
      const run = Run.create({
        id: runId,
        workspaceId: "ws-1" as never,
        agentId: "agent-1" as never,
        effectiveBindings: EffectiveRunBindings.create({
          agentVersionId: "agent-version-1" as never,
          modelProfileVersionBindings: {},
          toolVersionBindings: { echo: toolVersionId },
          memoryNamespaceBindings: {},
          knowledgeIndexBindings: {},
        }),
        input: {},
        createdAt: NOW,
      })
        .transitionTo("QUEUED", LATER)
        .transitionTo("RUNNING", LATER);

      const attempt = RunAttempt.createFirst({
        id: runAttemptId,
        runId,
        createdAt: NOW,
      }).transitionTo("RUNNING", LATER);

      await runs.saveRun(run);
      await runs.saveRunAttempt(attempt);
    }

    function createEngine(): DockerEngineAdapter {
      return new DockerEngineAdapter({
        client: dockerClient,
        network: { networkMode: "bridge" },
      });
    }

    function createAdapter(timeoutGrace = 0): ContainerRuntimeAdapter {
      const engine = createEngine();
      return new ContainerRuntimeAdapter({
        engine,
        resourcePolicy: DEFAULT_CONTAINER_RESOURCE_POLICY,
        getCapabilityBaseUrl: () => capabilityOrigin,
        capabilitySecret: CAPABILITY_SECRET,
        executionBootstrap: bootstrapStore,
        stopGraceMs: timeoutGrace,
      });
    }

    it("executes a container from a canonical digest-pinned runtime reference and removes the container", async () => {
      const adapter = createAdapter();
      const executionId = "run-attempt-success" as RunAttemptId;
      const request = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "echo", value: "hello" },
        { runAttemptId: executionId },
      );
      await seedRunningExecution(executionId, request.runId);

      const result = await adapter.execute(request);

      expect(result).toEqual({
        status: "succeeded",
        output: { mode: "echo", value: "hello" },
      });
      await assertNoOsvaManagedContainers(executionId);
    });

    it("invokes a tool capability through the runtime capability bridge", async () => {
      const adapter = createAdapter();
      const executionId = "run-attempt-tool" as RunAttemptId;
      const request = containerRequest(
        exampleImage.runtimeImageReference,
        {
          mode: "tool",
          binding: "echo",
          payload: { message: "capability-bridge" },
        },
        { runAttemptId: executionId },
      );
      await seedRunningExecution(executionId, request.runId);

      const result = await adapter.execute(request);

      expect(result).toEqual({
        status: "succeeded",
        output: { toolOutput: { echoed: true } },
      });
      await assertNoOsvaManagedContainers(executionId);
    });

    it("times out, kills, and removes a long-running container", async () => {
      const adapter = createAdapter(0);
      const executionId = "run-attempt-timeout" as RunAttemptId;
      const request = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "sleep", seconds: 60 },
        {
          runAttemptId: executionId,
          timeoutMs: 1_000,
        },
      );
      await seedRunningExecution(executionId, request.runId);

      const result = await adapter.execute(request);

      expect(result).toMatchObject({
        status: "failed",
        error: {
          code: RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
          message: "Container runtime execution timed out.",
        },
      });
      await assertNoOsvaManagedContainers(executionId);
    });

    it("removes containers after agent and protocol failures", async () => {
      const adapter = createAdapter();

      const agentExecutionId = "run-attempt-agent-fail" as RunAttemptId;
      const agentRequest = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "fail", message: "boom" },
        { runAttemptId: agentExecutionId },
      );
      await seedRunningExecution(agentExecutionId, agentRequest.runId);

      const agentFailure = await adapter.execute(agentRequest);
      expect(agentFailure).toMatchObject({
        status: "failed",
        error: { code: RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED },
      });
      await assertNoOsvaManagedContainers(agentExecutionId);

      const protocolExecutionId = "run-attempt-protocol-fail" as RunAttemptId;
      const protocolRequest = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "bad_stdout" },
        { runAttemptId: protocolExecutionId },
      );
      await seedRunningExecution(protocolExecutionId, protocolRequest.runId);

      const protocolFailure = await adapter.execute(protocolRequest);
      expect(protocolFailure).toMatchObject({
        status: "failed",
        error: { code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE },
      });
      await assertNoOsvaManagedContainers(protocolExecutionId);
    });

    it("removes stale OSVA-managed containers before redelivering the same RunAttemptId", async () => {
      const adapter = createAdapter();
      const executionId = "run-attempt-redelivery" as RunAttemptId;
      const request = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "echo", value: "redelivery" },
        { runAttemptId: executionId },
      );
      await seedRunningExecution(executionId, request.runId);

      const engine = createEngine();

      const stale = await engine.createContainer({
        executionId,
        image: { image: exampleImage.runtimeImageReference },
        resources: DEFAULT_CONTAINER_RESOURCE_POLICY.defaults,
        bootstrap: {
          executionId,
          bootstrapUrl: buildRuntimeExecutionBootstrapUrl(
            capabilityOrigin,
            executionId,
          ),
          bootstrapToken: "stale-placeholder",
        },
      });
      await engine.startContainer(stale);
      expect(await listOsvaManagedContainers(executionId)).not.toHaveLength(0);

      const result = await adapter.execute(request);
      expect(result.status).toBe("succeeded");
      await assertNoOsvaManagedContainers(executionId);
    });
  },
);
