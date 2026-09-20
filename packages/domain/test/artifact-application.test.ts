import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  Artifact,
  ArtifactIdempotencyConflictError,
  Workspace,
  createArtifactApplication,
  type ArtifactBlobStore,
  type ArtifactRepository,
  type RunRepository,
} from "../src/index.js";
import { readableFromBuffer } from "./artifact-test-blob-store.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const WORKSPACE = "ws-1" as WorkspaceId;

describe("Artifact application", () => {
  it("creates an artifact end-to-end", async () => {
    const { app } = createTestApp();

    const created = await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "hello.txt",
      mediaType: "text/plain",
      content: readableFromBuffer(Buffer.from("hello")),
    });

    expect(created.id).toBe("artifact-1");
    expect(created.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const opened = await app.openArtifactContent.execute(
      created.id as ArtifactId,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of opened.content.stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello");
  });

  it("returns the same artifact for the same idempotency key and identical bytes", async () => {
    const { app } = createTestApp();
    const key = "upload-1";

    const first = await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "same.bin",
      mediaType: "application/octet-stream",
      content: readableFromBuffer(Buffer.from("payload")),
      idempotencyKey: key,
    });

    const second = await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "same.bin",
      mediaType: "application/octet-stream",
      content: readableFromBuffer(Buffer.from("payload")),
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.digest).toBe(first.digest);
  });

  it("conflicts when the same idempotency key is reused with different bytes", async () => {
    const { app } = createTestApp();
    const key = "upload-2";

    await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "same.bin",
      mediaType: "application/octet-stream",
      content: readableFromBuffer(Buffer.from("first")),
      idempotencyKey: key,
    });

    await expect(
      app.createArtifact.execute({
        workspaceId: WORKSPACE,
        name: "same.bin",
        mediaType: "application/octet-stream",
        content: readableFromBuffer(Buffer.from("second")),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ArtifactIdempotencyConflictError);
  });

  it("conflicts when the same idempotency key is reused with a different name", async () => {
    const { app } = createTestApp();
    const key = "upload-3";

    await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "a.bin",
      mediaType: "application/octet-stream",
      content: readableFromBuffer(Buffer.from("payload")),
      idempotencyKey: key,
    });

    await expect(
      app.createArtifact.execute({
        workspaceId: WORKSPACE,
        name: "b.bin",
        mediaType: "application/octet-stream",
        content: readableFromBuffer(Buffer.from("payload")),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ArtifactIdempotencyConflictError);
  });

  it("conflicts when the same idempotency key is reused with different metadata", async () => {
    const { app } = createTestApp();
    const key = "upload-4";

    await app.createArtifact.execute({
      workspaceId: WORKSPACE,
      name: "same.bin",
      mediaType: "application/octet-stream",
      metadata: { tag: "a" },
      content: readableFromBuffer(Buffer.from("payload")),
      idempotencyKey: key,
    });

    await expect(
      app.createArtifact.execute({
        workspaceId: WORKSPACE,
        name: "same.bin",
        mediaType: "application/octet-stream",
        metadata: { tag: "b" },
        content: readableFromBuffer(Buffer.from("payload")),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ArtifactIdempotencyConflictError);
  });

  it("handles concurrent equivalent creates with one artifact and blob compensation", async () => {
    const workspaces = new FakeWorkspaceRepository();
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Workspace", createdAt: NOW }),
    );

    const artifacts = new FakeArtifactRepository();
    const blobStore = createTrackingBlobStore();
    let counter = 0;
    const app = createArtifactApplication({
      artifacts,
      blobStore: blobStore.store,
      workspaces,
      runs: new FakeRunRepository(),
      maxBytes: 1024,
      clock: { now: () => NOW },
      ids: { createId: () => `artifact-${++counter}` },
    });

    const command = {
      workspaceId: WORKSPACE,
      name: "race.bin",
      mediaType: "application/octet-stream",
      content: readableFromBuffer(Buffer.from("payload")),
      idempotencyKey: "race-key",
    };

    const [first, second] = await Promise.all([
      app.createArtifact.execute({
        ...command,
        content: readableFromBuffer(Buffer.from("payload")),
      }),
      app.createArtifact.execute({
        ...command,
        content: readableFromBuffer(Buffer.from("payload")),
      }),
    ]);

    expect(first.id).toBe(second.id);
    expect(blobStore.deletedKeys.length).toBeGreaterThan(0);
    expect(blobStore.storage.size).toBe(1);
  });

  it("handles concurrent conflicting creates with one winner and one conflict", async () => {
    const workspaces = new FakeWorkspaceRepository();
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Workspace", createdAt: NOW }),
    );

    const artifacts = new FakeArtifactRepository();
    const blobStore = createTrackingBlobStore();
    let counter = 0;
    const app = createArtifactApplication({
      artifacts,
      blobStore: blobStore.store,
      workspaces,
      runs: new FakeRunRepository(),
      maxBytes: 1024,
      clock: { now: () => NOW },
      ids: { createId: () => `artifact-${++counter}` },
    });

    const key = "race-conflict";
    const results = await Promise.allSettled([
      app.createArtifact.execute({
        workspaceId: WORKSPACE,
        name: "race.bin",
        mediaType: "application/octet-stream",
        content: readableFromBuffer(Buffer.from("alpha")),
        idempotencyKey: key,
      }),
      app.createArtifact.execute({
        workspaceId: WORKSPACE,
        name: "race.bin",
        mediaType: "application/octet-stream",
        content: readableFromBuffer(Buffer.from("beta")),
        idempotencyKey: key,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(
      ArtifactIdempotencyConflictError,
    );
    expect(blobStore.deletedKeys.length).toBeGreaterThan(0);
  });
});

function createTestApp() {
  const workspaces = new FakeWorkspaceRepository();
  void workspaces.save(
    Workspace.create({ id: WORKSPACE, name: "Workspace", createdAt: NOW }),
  );

  const artifacts = new FakeArtifactRepository();
  const blobStore = createTestBlobStore();
  let counter = 0;
  const app = createArtifactApplication({
    artifacts,
    blobStore,
    workspaces,
    runs: new FakeRunRepository(),
    maxBytes: 1024,
    clock: { now: () => NOW },
    ids: { createId: () => `artifact-${++counter}` },
  });

  return { app, artifacts, blobStore };
}

class FakeWorkspaceRepository {
  private readonly workspaces = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }
}

class FakeArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<ArtifactId, Artifact>();
  private readonly idempotency = new Map<string, ArtifactId>();

  async save(artifact: Artifact): Promise<void> {
    if (artifact.idempotencyKey !== undefined) {
      const existingId = this.idempotency.get(
        idempotencyMapKey(artifact.workspaceId, artifact.idempotencyKey),
      );
      if (existingId !== undefined && existingId !== artifact.id) {
        throw new Error(
          "Artifact idempotency key already exists in workspace.",
        );
      }
    }

    this.artifacts.set(artifact.id, artifact);
    if (artifact.idempotencyKey !== undefined) {
      this.idempotency.set(
        idempotencyMapKey(artifact.workspaceId, artifact.idempotencyKey),
        artifact.id,
      );
    }
  }

  async findById(artifactId: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async findByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Artifact | null> {
    const artifactId = this.idempotency.get(
      idempotencyMapKey(workspaceId, idempotencyKey),
    );
    if (artifactId === undefined) {
      return null;
    }

    return this.artifacts.get(artifactId) ?? null;
  }

  async list() {
    return { artifacts: [...this.artifacts.values()] };
  }
}

function idempotencyMapKey(
  workspaceId: WorkspaceId,
  idempotencyKey: string,
): string {
  return `${workspaceId}:${idempotencyKey}`;
}

class FakeRunRepository implements RunRepository {
  async findRunById() {
    return null;
  }

  async findRunAttemptById() {
    return null;
  }

  async createRunWithInitialAttempt(): Promise<void> {
    throw new Error("not used");
  }

  async saveRun(): Promise<void> {
    throw new Error("not used");
  }

  async findRunByWorkspaceIdempotencyKey() {
    return null;
  }

  async listRuns() {
    return { runs: [] };
  }

  async saveRunAttempt(): Promise<void> {
    throw new Error("not used");
  }

  async listRunAttempts() {
    return [];
  }

  async insertRunningRunStep(): Promise<void> {
    throw new Error("not used");
  }

  async finalizeRunStep(): Promise<never> {
    throw new Error("not used");
  }

  async findRunStepById() {
    return null;
  }

  async listRunSteps() {
    return { steps: [] };
  }

  async aggregateRunAttemptUsage(): Promise<never> {
    throw new Error("not used");
  }

  async transitionRun(): Promise<never> {
    throw new Error("not used");
  }

  async transitionRunAttempt(): Promise<never> {
    throw new Error("not used");
  }

  async transitionRunAndAttempt(): Promise<never> {
    throw new Error("not used");
  }
}

function createTestBlobStore(): ArtifactBlobStore {
  const storage = new Map<string, Buffer>();
  return {
    async write(input) {
      const chunks: Buffer[] = [];
      for await (const chunk of input.content) {
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length > input.maxBytes) {
        throw new Error("too large");
      }
      storage.set(input.key, bytes);
      const { createHash } = await import("node:crypto");
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (
        input.expectedDigest !== undefined &&
        input.expectedDigest !== digest
      ) {
        throw new Error("digest mismatch");
      }
      return { sizeBytes: bytes.length, digest };
    },
    async open(key) {
      const bytes = storage.get(key);
      if (bytes === undefined) {
        throw new Error("missing");
      }
      return {
        sizeBytes: bytes.length,
        stream: readableFromBuffer(bytes),
      };
    },
    async delete(key) {
      storage.delete(key);
    },
  };
}

function createTrackingBlobStore(): {
  store: ArtifactBlobStore;
  storage: Map<string, Buffer>;
  deletedKeys: string[];
} {
  const storage = new Map<string, Buffer>();
  const deletedKeys: string[] = [];
  const store: ArtifactBlobStore = {
    async write(input) {
      const chunks: Buffer[] = [];
      for await (const chunk of input.content) {
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      storage.set(input.key, bytes);
      const { createHash } = await import("node:crypto");
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      return { sizeBytes: bytes.length, digest };
    },
    async open(key) {
      const bytes = storage.get(key);
      if (bytes === undefined) {
        throw new Error("missing");
      }
      return { sizeBytes: bytes.length, stream: readableFromBuffer(bytes) };
    },
    async delete(key) {
      deletedKeys.push(key);
      storage.delete(key);
    },
  };
  return { store, storage, deletedKeys };
}
