import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFilesystemArtifactBlobStore } from "@osva/adapters-artifact-filesystem";
import {
  ContainerRuntimeAdapter,
  DEFAULT_CONTAINER_RESOURCE_POLICY,
  DockerEngineAdapter,
  createDockerodeClient,
  suggestContainerCapabilityBaseUrl,
} from "@osva/adapters-runtime-container";
import {
  RuntimeCapabilityBridge,
  RuntimeExecutionBootstrapStore,
  createArtifactCapabilityRawHandler,
  startRuntimeCapabilityServer,
  type RuntimeCapabilityServer,
} from "@osva/adapters-runtime-http";
import type {
  ArtifactId,
  ExecutionRequest,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresArtifactRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  Run,
  RunAttempt,
  Workspace,
  artifactBlobStorageKey,
  createArtifactApplication,
  createRuntimeArtifactApplication,
} from "@osva/domain";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  assertNoOsvaManagedContainers,
  buildExampleContainerImage,
  createLocalImageAliasingDockerClient,
  isDockerAvailable,
  type ExampleContainerImageFixture,
} from "../../../../adapters/runtime-container/test/integration/docker-harness.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";

const CAPABILITY_SECRET = "container-artifact-integration-secret";
const WORKSPACE_ID = "ws-container-artifact" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");
const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)(
  "container runtime artifact integration",
  () => {
    let postgres: PostgresTestContext;
    let database: Database;
    let exampleImage: ExampleContainerImageFixture;
    let artifactRoot: string;
    let capabilityOrigin = "";
    let capabilityServer: RuntimeCapabilityServer | undefined;
    let bootstrapStore: RuntimeExecutionBootstrapStore;
    let runs: PostgresRunRepository;
    let agents: PostgresAgentRepository;
    let artifactsRepository: PostgresArtifactRepository;
    let blobStore: ReturnType<typeof createFilesystemArtifactBlobStore>;
    let runtimeArtifacts: ReturnType<typeof createRuntimeArtifactApplication>;

    async function seedRunningExecution(
      runAttemptId: RunAttemptId,
      runId: RunId,
    ): Promise<void> {
      const run = Run.create({
        id: runId,
        workspaceId: WORKSPACE_ID,
        agentId: "agent-container-artifact" as never,
        effectiveBindings: EffectiveRunBindings.create({
          agentVersionId: "agent-version-container-artifact" as never,
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
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

    beforeAll(async () => {
      postgres = await startPostgresForTests();
      database = createDatabase({
        connectionString: postgres.connectionString,
        max: 5,
        connectTimeoutSeconds: 10,
      });
      await migrateDatabase(database);

      exampleImage = await buildExampleContainerImage();
      artifactRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "osva-container-artifact-store-"),
      );
      blobStore = createFilesystemArtifactBlobStore({
        rootDirectory: artifactRoot,
      });
      artifactsRepository = new PostgresArtifactRepository(database);

      bootstrapStore = new RuntimeExecutionBootstrapStore();
      runs = new PostgresRunRepository(database);
      agents = new PostgresAgentRepository(database);

      const workspaces = new PostgresWorkspaceRepository(database);
      const artifactApplication = createArtifactApplication({
        artifacts: artifactsRepository,
        blobStore,
        workspaces,
        runs: runs as never,
        maxBytes: 1_048_576,
        clock: { now: () => NOW },
        ids: { createId: () => randomUUID() },
      });
      runtimeArtifacts = createRuntimeArtifactApplication(artifactApplication);

      const bridge = new RuntimeCapabilityBridge({
        secret: CAPABILITY_SECRET,
        runs,
        agents,
        executionBootstrap: bootstrapStore,
        clock: { now: () => NOW },
        createScopedModelGateway: () => undefined,
        createScopedToolGateway: () => undefined,
        createScopedMemoryGateway: () => undefined,
        createScopedKnowledgeGateway: () => undefined,
        artifactApplication: runtimeArtifacts,
        maxArtifactBytes: 1_048_576,
      });

      capabilityServer = await startRuntimeCapabilityServer({
        host: "0.0.0.0",
        handler: bridge.handle,
        rawHandler: createArtifactCapabilityRawHandler(bridge, {
          artifacts: runtimeArtifacts,
          maxBytes: 1_048_576,
        }),
      });
      capabilityOrigin = suggestContainerCapabilityBaseUrl(
        capabilityServer.port,
      );
    });

    beforeEach(async () => {
      await resetStage0Tables(database);
      await new PostgresWorkspaceRepository(database).save(
        Workspace.create({
          id: WORKSPACE_ID,
          name: "Container Artifact Workspace",
          createdAt: NOW,
        }),
      );

      await agents.saveAgent(
        Agent.create({
          id: "agent-container-artifact" as never,
          workspaceId: WORKSPACE_ID,
          key: "container-artifact-agent",
          name: "Container Artifact Agent",
          createdAt: NOW,
        }),
      );
      await agents.saveAgentVersion(
        AgentVersion.create({
          id: "agent-version-container-artifact" as never,
          agentId: "agent-container-artifact" as never,
          version: 1,
          manifest: {
            schemaVersion: "1",
            key: "container-artifact-agent",
            name: "Container Artifact Agent",
            runtime: {
              type: "CONTAINER",
              protocolVersion: "1",
              image: exampleImage.runtimeImageReference,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 15_000, maxAttempts: 1 },
            capabilities: { model: false, tools: [] },
          },
          createdAt: NOW,
        }),
      );
    });

    afterEach(async () => {
      await assertNoOsvaManagedContainers();
    });

    afterAll(async () => {
      if (capabilityServer !== undefined) {
        await capabilityServer.close();
      }
      await fs.rm(artifactRoot, { force: true, recursive: true });
      await database.close();
      await stopPostgresForTests(postgres);
    });

    it("creates an Artifact from a container agent and persists it after container exit", async () => {
      const dockerClient = createLocalImageAliasingDockerClient({
        delegate: createDockerodeClient(),
        runtimeImageReference: exampleImage.runtimeImageReference,
        localDockerImage: exampleImage.localDockerImage,
      });
      const engine = new DockerEngineAdapter({
        client: dockerClient,
        network: { networkMode: "bridge" },
      });
      const adapter = new ContainerRuntimeAdapter({
        engine,
        resourcePolicy: DEFAULT_CONTAINER_RESOURCE_POLICY,
        getCapabilityBaseUrl: () => capabilityOrigin,
        capabilitySecret: CAPABILITY_SECRET,
        executionBootstrap: bootstrapStore,
        stopGraceMs: 0,
      });

      const executionId = "run-attempt-container-artifact" as RunAttemptId;
      const runId = "run-container-artifact" as RunId;
      const payload = "container-artifact-round-trip";
      const request = containerRequest(
        exampleImage.runtimeImageReference,
        { mode: "artifact", content: payload },
        { runAttemptId: executionId, runId },
      );
      await seedRunningExecution(executionId, runId);

      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "succeeded",
        output: {
          roundTrip: payload,
          name: "container-artifact.txt",
          reference: {
            type: "artifact",
            artifactId: expect.any(String),
          },
        },
      });

      const artifactId = (
        result as { output: { reference: { artifactId: string } } }
      ).output.reference.artifactId as ArtifactId;

      const artifact = await artifactsRepository.findById(artifactId);
      expect(artifact).toMatchObject({
        workspaceId: WORKSPACE_ID,
        producerRunId: runId,
        producerRunAttemptId: executionId,
        name: "container-artifact.txt",
      });

      const opened = await blobStore.open(artifactBlobStorageKey(artifactId));
      const chunks: Buffer[] = [];
      for await (const chunk of opened.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString("utf8")).toBe(payload);
      await assertNoOsvaManagedContainers(executionId);
    });
  },
);

function containerRequest(
  image: string,
  input: unknown,
  overrides: {
    readonly runAttemptId: RunAttemptId;
    readonly runId: RunId;
  },
): ExecutionRequest {
  return {
    runId: overrides.runId,
    runAttemptId: overrides.runAttemptId,
    workspaceId: WORKSPACE_ID,
    agentId: "agent-container-artifact" as ExecutionRequest["agentId"],
    agentVersionId:
      "agent-version-container-artifact" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "CONTAINER",
      protocolVersion: "1",
      image,
    },
    input,
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    timeoutMs: 15_000,
    policyContext: {},
  };
}
