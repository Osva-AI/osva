import type { Readable } from "node:stream";
import type {
  ArtifactId,
  JsonObject,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";

import { Artifact } from "./artifact.js";
import { artifactBlobStorageKey } from "./artifact-blob-key.js";
import {
  ArtifactBlobUnavailableError,
  ArtifactDigestMismatchError,
  ArtifactIdempotencyConflictError,
  ArtifactNotFoundError,
  ArtifactPayloadTooLargeError,
  ArtifactProducerWorkspaceMismatchError,
  DomainInvariantError,
  RunAttemptNotFoundError,
  RunNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { jsonValuesEqual } from "./json-equality.js";
import type { ArtifactBlobStore } from "./ports/artifact-blob-store.js";
import {
  DEFAULT_ARTIFACT_LIST_LIMIT,
  type ArtifactRepository,
  type ListArtifactsQuery,
  type ListArtifactsResult,
} from "./ports/artifact-repository.js";
import type { RunRepository } from "./ports/run-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

export interface ArtifactApplicationClock {
  now(): Date;
}

export interface ArtifactApplicationIds {
  createId(): string;
}

export interface ArtifactApplicationLogger {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface ArtifactApplicationDependencies {
  readonly artifacts: ArtifactRepository;
  readonly blobStore: ArtifactBlobStore;
  readonly workspaces: WorkspaceRepository;
  readonly runs: RunRepository;
  readonly maxBytes: number;
  readonly clock: ArtifactApplicationClock;
  readonly ids: ArtifactApplicationIds;
  readonly logger?: ArtifactApplicationLogger;
}

export interface CreateArtifactCommand {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly mediaType: string;
  readonly metadata?: JsonObject;
  readonly content: Readable;
  readonly expectedDigest?: string;
  readonly idempotencyKey?: string;
  readonly producerRunId?: RunId;
  readonly producerRunAttemptId?: RunAttemptId;
}

export interface OpenArtifactContentResult {
  readonly artifact: Artifact;
  readonly content: Awaited<ReturnType<ArtifactBlobStore["open"]>>;
}

export class CreateArtifact {
  constructor(private readonly deps: ArtifactApplicationDependencies) {}

  async execute(command: CreateArtifactCommand): Promise<Artifact> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    await validateProducer(command, this.deps);

    const artifactId = this.deps.ids.createId() as ArtifactId;
    const blobKey = artifactBlobStorageKey(artifactId);

    this.deps.logger?.info("artifact.create.started", {
      artifactId,
      workspaceId: command.workspaceId,
    });

    let writeResult;
    try {
      writeResult = await this.deps.blobStore.write({
        key: blobKey,
        content: command.content,
        maxBytes: this.deps.maxBytes,
        expectedDigest: command.expectedDigest,
      });
    } catch (error) {
      this.deps.logger?.warn("artifact.create.blob_failed", {
        artifactId,
        workspaceId: command.workspaceId,
      });
      throw mapBlobWriteError(error, this.deps.maxBytes);
    }

    if (command.idempotencyKey !== undefined) {
      const replay = await reconcileIdempotentCreation(
        this.deps,
        command,
        writeResult.digest,
        writeResult.sizeBytes,
        blobKey,
        artifactId,
      );
      if (replay !== null) {
        return replay;
      }
    }

    const artifact = Artifact.create({
      id: artifactId,
      workspaceId: command.workspaceId,
      name: command.name,
      mediaType: command.mediaType,
      sizeBytes: writeResult.sizeBytes,
      digest: writeResult.digest,
      metadata: command.metadata ?? {},
      producerRunId: command.producerRunId,
      producerRunAttemptId: command.producerRunAttemptId,
      idempotencyKey: command.idempotencyKey,
      createdAt: this.deps.clock.now(),
    });

    try {
      await this.deps.artifacts.save(artifact);
    } catch (error) {
      if (command.idempotencyKey !== undefined) {
        const replay = await reconcileIdempotentCreation(
          this.deps,
          command,
          writeResult.digest,
          writeResult.sizeBytes,
          blobKey,
          artifactId,
        );
        if (replay !== null) {
          return replay;
        }
      }

      await compensateBlob(this.deps, blobKey, artifactId);
      this.deps.logger?.warn("artifact.create.metadata_failed", {
        artifactId,
        workspaceId: command.workspaceId,
      });
      throw error;
    }

    this.deps.logger?.info("artifact.create.completed", {
      artifactId: artifact.id,
      workspaceId: artifact.workspaceId,
      sizeBytes: artifact.sizeBytes,
    });

    return artifact;
  }
}

export class GetArtifact {
  constructor(
    private readonly deps: Pick<ArtifactApplicationDependencies, "artifacts">,
  ) {}

  async execute(artifactId: ArtifactId): Promise<Artifact> {
    const artifact = await this.deps.artifacts.findById(artifactId);
    if (artifact === null) {
      throw new ArtifactNotFoundError(artifactId);
    }

    return artifact;
  }
}

export class ListArtifacts {
  constructor(
    private readonly deps: Pick<
      ArtifactApplicationDependencies,
      "artifacts" | "workspaces"
    >,
  ) {}

  async execute(query: ListArtifactsQuery): Promise<ListArtifactsResult> {
    const workspace = await this.deps.workspaces.findById(query.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(query.workspaceId);
    }

    return this.deps.artifacts.list({
      ...query,
      limit: query.limit ?? DEFAULT_ARTIFACT_LIST_LIMIT,
    });
  }
}

export class OpenArtifactContent {
  constructor(private readonly deps: ArtifactApplicationDependencies) {}

  async execute(artifactId: ArtifactId): Promise<OpenArtifactContentResult> {
    const artifact = await this.deps.artifacts.findById(artifactId);
    if (artifact === null) {
      throw new ArtifactNotFoundError(artifactId);
    }

    const blobKey = artifactBlobStorageKey(artifact.id);
    try {
      const content = await this.deps.blobStore.open(blobKey);
      return { artifact, content };
    } catch {
      throw new ArtifactBlobUnavailableError(artifactId);
    }
  }
}

export interface ArtifactApplication {
  readonly createArtifact: CreateArtifact;
  readonly getArtifact: GetArtifact;
  readonly listArtifacts: ListArtifacts;
  readonly openArtifactContent: OpenArtifactContent;
}

export function createArtifactApplication(
  deps: ArtifactApplicationDependencies,
): ArtifactApplication {
  return {
    createArtifact: new CreateArtifact(deps),
    getArtifact: new GetArtifact(deps),
    listArtifacts: new ListArtifacts(deps),
    openArtifactContent: new OpenArtifactContent(deps),
  };
}

async function validateProducer(
  command: CreateArtifactCommand,
  deps: ArtifactApplicationDependencies,
): Promise<void> {
  const hasRun = command.producerRunId !== undefined;
  const hasAttempt = command.producerRunAttemptId !== undefined;
  if (!hasRun && !hasAttempt) {
    return;
  }

  if (hasRun !== hasAttempt) {
    throw new DomainInvariantError(
      "Artifact producer Run and RunAttempt must both be present or both absent.",
    );
  }

  const run = await deps.runs.findRunById(command.producerRunId!);
  if (run === null) {
    throw new RunNotFoundError(command.producerRunId!);
  }

  if (run.workspaceId !== command.workspaceId) {
    throw new ArtifactProducerWorkspaceMismatchError(
      command.workspaceId,
      command.producerRunId!,
    );
  }

  const attempt = await deps.runs.findRunAttemptById(
    command.producerRunAttemptId!,
  );
  if (attempt === null) {
    throw new RunAttemptNotFoundError(command.producerRunAttemptId!);
  }

  if (attempt.runId !== command.producerRunId) {
    throw new RunAttemptNotFoundError(command.producerRunAttemptId!);
  }
}

function assertIdempotentReplay(
  existing: Artifact,
  command: CreateArtifactCommand,
  digest: string,
  sizeBytes: number,
): void {
  const metadata = command.metadata ?? {};
  if (
    existing.name !== command.name ||
    existing.mediaType !== command.mediaType ||
    !jsonValuesEqual(existing.metadata, metadata) ||
    existing.producerRunId !== command.producerRunId ||
    existing.producerRunAttemptId !== command.producerRunAttemptId ||
    existing.digest !== digest ||
    existing.sizeBytes !== sizeBytes
  ) {
    throw new ArtifactIdempotencyConflictError(
      command.workspaceId,
      command.idempotencyKey!,
    );
  }
}

async function reconcileIdempotentCreation(
  deps: ArtifactApplicationDependencies,
  command: CreateArtifactCommand,
  digest: string,
  sizeBytes: number,
  blobKey: string,
  artifactId: ArtifactId,
): Promise<Artifact | null> {
  const existing = await deps.artifacts.findByWorkspaceIdempotencyKey(
    command.workspaceId,
    command.idempotencyKey!,
  );
  if (existing === null) {
    return null;
  }

  try {
    assertIdempotentReplay(existing, command, digest, sizeBytes);
  } catch (error) {
    await compensateBlob(deps, blobKey, artifactId);
    throw error;
  }

  await compensateBlob(deps, blobKey, artifactId);
  return existing;
}

async function compensateBlob(
  deps: ArtifactApplicationDependencies,
  blobKey: string,
  artifactId: ArtifactId,
): Promise<void> {
  try {
    await deps.blobStore.delete(blobKey);
  } catch {
    deps.logger?.warn("artifact.create.compensation_delete_failed", {
      artifactId,
    });
  }
}

function mapBlobWriteError(error: unknown, maxBytes: number): unknown {
  if (error instanceof ArtifactPayloadTooLargeError) {
    return error;
  }
  if (error instanceof ArtifactDigestMismatchError) {
    return error;
  }
  if (
    error instanceof Error &&
    error.message.includes("maximum") &&
    error.message.includes("bytes")
  ) {
    return new ArtifactPayloadTooLargeError(maxBytes);
  }
  return error;
}
