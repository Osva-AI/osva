import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createArtifactBlobStore,
  loadArtifactStorageConfig,
} from "@osva/adapters-artifact-storage";
import { OsvaKnowledgeParserRegistry } from "@osva/adapters-knowledge-parser";
import { PgVectorStore } from "@osva/adapters-vector-pgvector";
import type { WorkspaceId } from "@osva/contracts";
import {
  KNOWLEDGE_MAX_EXTRACTED_BYTES,
  KNOWLEDGE_MAX_SOURCE_BYTES,
} from "@osva/contracts";
import type { Database } from "@osva/db";
import {
  PostgresArtifactRepository,
  PostgresKnowledgeRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
} from "@osva/db";
import {
  createArtifactApplication,
  createKnowledgeApplication,
  KnowledgeIngestionService,
  KnowledgeRetriever,
  runtimeControlPlaneScope,
  type KnowledgeEmbeddingDefaults,
  type KnowledgeIndexQueue,
} from "@osva/domain";
import {
  DeterministicEmbeddingProviderAdapter,
  EmbeddingGateway,
} from "@osva/embedding-gateway";

export const TEST_EMBEDDING_DEFAULTS: KnowledgeEmbeddingDefaults = {
  provider: "DETERMINISTIC",
  model: "deterministic-test",
  dimensions: 32,
};

export interface KnowledgeIntegrationStack {
  readonly knowledge: PostgresKnowledgeRepository;
  readonly artifacts: ReturnType<typeof createArtifactApplication>;
  readonly knowledgeApp: ReturnType<typeof createKnowledgeApplication>;
  readonly ingestion: KnowledgeIngestionService;
  readonly retriever: KnowledgeRetriever;
  readonly vectorStore: PgVectorStore;
  readonly embeddingGateway: EmbeddingGateway;
  readonly workspaces: PostgresWorkspaceRepository;
  readonly clock: { now(): Date };
  readonly ids: { createId(): string };
  readonly artifactRoot: string;
}

export async function createKnowledgeIntegrationStack(
  database: Database,
  options?: {
    readonly embeddingDefaults?: KnowledgeEmbeddingDefaults;
    readonly vectorStore?: PgVectorStore;
    readonly now?: Date;
  },
): Promise<KnowledgeIntegrationStack> {
  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-knowledge-test-"),
  );
  const artifactStorage = loadArtifactStorageConfig({
    OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
  });
  const clock = { now: () => options?.now ?? new Date() };
  let counter = 0;
  const ids = {
    createId: () => {
      counter += 1;
      return `knowledge-test-id-${String(counter)}`;
    },
  };

  const knowledge = new PostgresKnowledgeRepository(database);
  const artifactsRepository = new PostgresArtifactRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const runs = new PostgresRunRepository(database);
  const blobStore = createArtifactBlobStore(artifactStorage);
  const artifacts = createArtifactApplication({
    artifacts: artifactsRepository,
    blobStore,
    workspaces,
    runs,
    maxBytes: artifactStorage.maxBytes,
    clock,
    ids,
  });

  const noopQueue: KnowledgeIndexQueue = {
    enqueue: async () => undefined,
  };
  const embeddingDefaults =
    options?.embeddingDefaults ?? TEST_EMBEDDING_DEFAULTS;
  const knowledgeApp = createKnowledgeApplication({
    knowledge,
    artifacts: artifactsRepository,
    workspaces,
    indexQueue: noopQueue,
    embeddingDefaults,
    clock,
    ids,
  });

  const embeddingGateway = new EmbeddingGateway({
    providers: {
      DETERMINISTIC: new DeterministicEmbeddingProviderAdapter(),
    },
  });
  const vectorStore = options?.vectorStore ?? new PgVectorStore(database);

  const ingestion = new KnowledgeIngestionService({
    knowledge,
    parsers: new OsvaKnowledgeParserRegistry(),
    createArtifact: artifacts.createArtifact,
    openArtifact: artifacts.openArtifactContent,
    embeddings: embeddingGateway,
    vectorStore,
    clock,
    ids,
    maxSourceBytes: Math.min(
      artifactStorage.maxBytes,
      KNOWLEDGE_MAX_SOURCE_BYTES,
    ),
    maxExtractedBytes: KNOWLEDGE_MAX_EXTRACTED_BYTES,
  });

  const retriever = new KnowledgeRetriever({
    knowledge,
    embeddings: embeddingGateway,
    vectorStore,
  });

  return {
    knowledge,
    artifacts,
    knowledgeApp,
    ingestion,
    retriever,
    vectorStore,
    embeddingGateway,
    workspaces,
    clock,
    ids,
    artifactRoot,
  };
}

export function integrationControlPlaneScope(workspaceId: WorkspaceId) {
  return runtimeControlPlaneScope(workspaceId);
}

export async function uploadTextArtifact(
  stack: KnowledgeIntegrationStack,
  workspaceId: WorkspaceId,
  name: string,
  body: string,
  mediaType = "text/plain",
) {
  return stack.artifacts.createArtifact.execute(
    integrationControlPlaneScope(workspaceId),
    {
      workspaceId,
      name,
      mediaType,
      content: Readable.from(body),
    },
  );
}
