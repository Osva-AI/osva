import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { ARTIFACT_ERROR_CODES } from "@osva/contracts";
import type {
  AgentId,
  AgentVersionId,
  ArtifactId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  Artifact,
  EffectiveRunBindings,
  Run,
  RunAttempt,
  Workspace,
  createArtifactApplication,
  createRuntimeArtifactApplication,
  type ArtifactBlobStore,
  type ArtifactRepository,
  type RunRepository,
} from "@osva/domain";
import { RUNTIME_CAPABILITY_PATHS } from "@osva/runtime-protocol";
import { describe, expect, it } from "vitest";

import {
  RuntimeCapabilityBridge,
  createArtifactCapabilityRawHandler,
  issueCapabilityToken,
  startRuntimeCapabilityServer,
} from "../src/index.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");
const EVEN_LATER = new Date("2026-01-15T12:00:02.000Z");
const SECRET = "artifact-capability-secret";
const workspaceId = "ws-artifact" as WorkspaceId;
const agentId = "agent-artifact" as AgentId;
const agentVersionId = "agent-version-artifact" as AgentVersionId;
const runId = "run-artifact" as RunId;
const runAttemptId = "run-attempt-artifact" as RunAttemptId;

describe("runtime artifact capabilities", () => {
  it("creates, gets metadata, and streams content over HTTP", async () => {
    const seeded = await seedExecution();
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
      artifactApplication: seeded.runtimeArtifacts,
      maxArtifactBytes: 1_048_576,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
      rawHandler: createArtifactCapabilityRawHandler(bridge, {
        artifacts: seeded.runtimeArtifacts,
        maxBytes: 1_048_576,
      }),
    });

    const token = issueCapabilityToken(SECRET, {
      executionId: runAttemptId,
      runId,
      workspaceId,
      exp: NOW.getTime() + 60_000,
    });

    try {
      const form = new FormData();
      form.append("executionId", runAttemptId);
      form.append("name", "hello.txt");
      form.append("mediaType", "text/plain");
      form.append("file", new Blob(["hello artifact"]), "hello.txt");

      const createResponse = await fetch(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.artifactCreate}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: form,
        },
      );
      const created = await createResponse.json();
      expect(created).toMatchObject({
        outcome: "SUCCEEDED",
        artifact: { name: "hello.txt" },
      });
      const artifactId = (created as { artifact: { id: string } }).artifact.id;

      const getResponse = await fetch(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.artifactGet}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: "1",
            executionId: runAttemptId,
            artifactId,
          }),
        },
      );
      const metadata = await getResponse.json();
      expect(metadata).toMatchObject({
        outcome: "SUCCEEDED",
        artifact: { id: artifactId },
      });

      const contentUrl = new URL(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.artifactContent}`,
      );
      contentUrl.searchParams.set("executionId", runAttemptId);
      contentUrl.searchParams.set("artifactId", artifactId);
      const contentResponse = await fetch(contentUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(contentResponse.status).toBe(200);
      expect(await contentResponse.text()).toBe("hello artifact");
    } finally {
      await server.close();
    }
  });

  it("rejects cross-workspace artifact reads without leaking storage details", async () => {
    const workspaceA = "ws-artifact-a" as WorkspaceId;
    const workspaceB = "ws-artifact-b" as WorkspaceId;
    const attemptA = "run-attempt-a" as RunAttemptId;
    const attemptB = "run-attempt-b" as RunAttemptId;
    const runA = "run-a" as RunId;
    const runB = "run-b" as RunId;

    const seeded = await seedCrossWorkspaceExecution({
      workspaceA,
      workspaceB,
      attemptA,
      attemptB,
      runA,
      runB,
    });

    const created = await seeded.runtimeArtifacts.createRuntimeArtifact.execute(
      {
        execution: {
          workspaceId: workspaceA,
          runId: runA,
          runAttemptId: attemptA,
        },
        name: "secret.txt",
        mediaType: "text/plain",
        content: Readable.from(["workspace-a-bytes"]),
      },
    );

    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
      artifactApplication: seeded.runtimeArtifacts,
      maxArtifactBytes: 1_048_576,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
      rawHandler: createArtifactCapabilityRawHandler(bridge, {
        artifacts: seeded.runtimeArtifacts,
        maxBytes: 1_048_576,
      }),
    });

    const tokenB = issueCapabilityToken(SECRET, {
      executionId: attemptB,
      runId: runB,
      workspaceId: workspaceB,
      exp: NOW.getTime() + 60_000,
    });

    try {
      const getResponse = await fetch(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.artifactGet}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${tokenB}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: "1",
            executionId: attemptB,
            artifactId: created.id,
          }),
        },
      );
      const getBody = await getResponse.json();
      expect(getBody).toMatchObject({
        outcome: "FAILED",
        error: { code: ARTIFACT_ERROR_CODES.ARTIFACT_NOT_FOUND },
      });
      expect(JSON.stringify(getBody)).not.toMatch(
        /s3|bucket|filesystem|\.osva/i,
      );

      const contentUrl = new URL(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.artifactContent}`,
      );
      contentUrl.searchParams.set("executionId", attemptB);
      contentUrl.searchParams.set("artifactId", created.id);
      const contentResponse = await fetch(contentUrl, {
        headers: { authorization: `Bearer ${tokenB}` },
      });
      const contentBody = await contentResponse.json();
      expect(contentBody).toMatchObject({
        outcome: "FAILED",
        error: { code: ARTIFACT_ERROR_CODES.ARTIFACT_NOT_FOUND },
      });
      expect(JSON.stringify(contentBody)).not.toMatch(
        /v1\/|secret-bucket|AccessKey/i,
      );
    } finally {
      await server.close();
    }
  });
});

async function seedExecution() {
  const runs = new MemoryRunRepository();
  const agents = new MemoryAgentRepository();
  const artifactsRepo = new FakeArtifactRepository();
  const blobStore = new MemoryArtifactBlobStore();

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId,
      key: "artifact-agent",
      name: "Artifact Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: {
        schemaVersion: "1",
        key: "artifact-agent",
        name: "Artifact Agent",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "agent.ts",
          integrity:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
      createdAt: NOW,
    }),
  );

  const run = Run.create({
    id: runId,
    workspaceId,
    agentId,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId,
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: {},
    }),
    input: {},
    createdAt: NOW,
  })
    .transitionTo("QUEUED", LATER)
    .transitionTo("RUNNING", EVEN_LATER);

  const attempt = RunAttempt.createFirst({
    id: runAttemptId,
    runId,
    createdAt: NOW,
  }).transitionTo("RUNNING", EVEN_LATER);

  await runs.saveRun(run);
  await runs.saveRunAttempt(attempt);

  const workspaces = {
    async save() {},
    async findById(id: WorkspaceId) {
      return Workspace.create({ id, name: "Workspace", createdAt: NOW });
    },
    async countAll() {
      return 1;
    },
    async listIds() {
      return [workspaceId];
    },
  };

  const artifactApplication = createArtifactApplication({
    artifacts: artifactsRepo,
    blobStore,
    workspaces,
    runs: runs as RunRepository,
    maxBytes: 1_048_576,
    clock: { now: () => NOW },
    ids: { createId: () => randomUUID() },
  });

  return {
    runs,
    agents,
    runtimeArtifacts: createRuntimeArtifactApplication(artifactApplication),
  };
}

async function seedCrossWorkspaceExecution(options: {
  readonly workspaceA: WorkspaceId;
  readonly workspaceB: WorkspaceId;
  readonly attemptA: RunAttemptId;
  readonly attemptB: RunAttemptId;
  readonly runA: RunId;
  readonly runB: RunId;
}) {
  const runs = new MemoryRunRepository();
  const agents = new MemoryAgentRepository();
  const artifactsRepo = new FakeArtifactRepository();
  const blobStore = new MemoryArtifactBlobStore();

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId: options.workspaceA,
      key: "artifact-agent",
      name: "Artifact Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: {
        schemaVersion: "1",
        key: "artifact-agent",
        name: "Artifact Agent",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "agent.ts",
          integrity:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
      createdAt: NOW,
    }),
  );

  for (const [workspaceId, runId, attemptId] of [
    [options.workspaceA, options.runA, options.attemptA],
    [options.workspaceB, options.runB, options.attemptB],
  ] as const) {
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: EffectiveRunBindings.create({
        agentVersionId,
        modelProfileVersionBindings: {},
        toolVersionBindings: {},
        memoryNamespaceBindings: {},
        knowledgeIndexBindings: {},
      }),
      input: {},
      createdAt: NOW,
    })
      .transitionTo("QUEUED", LATER)
      .transitionTo("RUNNING", EVEN_LATER);

    const attempt = RunAttempt.createFirst({
      id: attemptId,
      runId,
      createdAt: NOW,
    }).transitionTo("RUNNING", EVEN_LATER);

    await runs.saveRun(run);
    await runs.saveRunAttempt(attempt);
  }

  const workspaces = {
    async save() {},
    async findById(id: WorkspaceId) {
      return Workspace.create({ id, name: "Workspace", createdAt: NOW });
    },
    async countAll() {
      return 2;
    },
    async listIds() {
      return [options.workspaceA, options.workspaceB];
    },
  };

  const artifactApplication = createArtifactApplication({
    artifacts: artifactsRepo,
    blobStore,
    workspaces,
    runs: runs as RunRepository,
    maxBytes: 1_048_576,
    clock: { now: () => NOW },
    ids: { createId: () => randomUUID() },
  });

  return {
    runs,
    agents,
    runtimeArtifacts: createRuntimeArtifactApplication(artifactApplication),
  };
}

class FakeArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<ArtifactId, Artifact>();

  async save(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
  }

  async findById(artifactId: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (artifact === undefined || artifact.workspaceId !== workspaceId) {
      return null;
    }
    return artifact;
  }

  async findByWorkspaceIdempotencyKey(): Promise<Artifact | null> {
    return null;
  }

  async list() {
    return { artifacts: [...this.artifacts.values()] };
  }
}

class MemoryArtifactBlobStore implements ArtifactBlobStore {
  private readonly blobs = new Map<string, Buffer>();

  async write(input: {
    readonly key: string;
    readonly content: Readable;
    readonly maxBytes: number;
  }) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input.content) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > input.maxBytes) {
        throw new Error("too large");
      }
      chunks.push(buffer);
    }
    const payload = Buffer.concat(chunks);
    const crypto = await import("node:crypto");
    const digest = crypto.createHash("sha256").update(payload).digest("hex");
    this.blobs.set(input.key, payload);
    return {
      sizeBytes: payload.length,
      digest: `sha256:${digest}`,
    };
  }

  async open(key: string) {
    const payload = this.blobs.get(key);
    if (payload === undefined) {
      throw new Error("missing");
    }
    return {
      sizeBytes: payload.length,
      stream: Readable.from(payload),
    };
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}
