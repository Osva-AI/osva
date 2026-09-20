import { randomUUID } from "node:crypto";

import {
  createArtifactBlobStore,
  loadArtifactStorageConfig,
} from "@osva/adapters-artifact-storage";
import { BullMqKnowledgeIndexQueue } from "@osva/adapters-bullmq";
import { OpenAiCompatibleEmbeddingAdapter } from "@osva/adapters-embedding-openai-compatible";
import { OsvaKnowledgeParserRegistry } from "@osva/adapters-knowledge-parser";
import { PgVectorStore } from "@osva/adapters-vector-pgvector";
import {
  KNOWLEDGE_MAX_EXTRACTED_BYTES,
  KNOWLEDGE_MAX_SOURCE_BYTES,
} from "@osva/contracts";
import {
  createDatabase,
  PostgresArtifactRepository,
  PostgresKnowledgeRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  createArtifactApplication,
  KnowledgeIngestionService,
} from "@osva/domain";
import {
  DeterministicEmbeddingProviderAdapter,
  EmbeddingGateway,
} from "@osva/embedding-gateway";

import {
  loadKnowledgeWorkerConfig,
  type KnowledgeWorkerConfig,
} from "./config.js";
import { logEvent } from "./log.js";

export interface KnowledgeWorkerProcess {
  readonly config: KnowledgeWorkerConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createKnowledgeWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
): KnowledgeWorkerProcess {
  const config = loadKnowledgeWorkerConfig(env);
  const artifactStorage = loadArtifactStorageConfig(env);
  const database = databaseFactory(config.databaseUrl);
  const knowledgeRepository = new PostgresKnowledgeRepository(database);
  const artifactsRepository = new PostgresArtifactRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const runs = new PostgresRunRepository(database);
  const blobStore = createArtifactBlobStore(artifactStorage);
  const clock = { now: () => new Date() };
  const ids = { createId: () => randomUUID() };
  const artifacts = createArtifactApplication({
    artifacts: artifactsRepository,
    blobStore,
    workspaces,
    runs,
    maxBytes: artifactStorage.maxBytes,
    clock,
    ids,
  });

  const providers: Record<
    string,
    DeterministicEmbeddingProviderAdapter | OpenAiCompatibleEmbeddingAdapter
  > = {
    DETERMINISTIC: new DeterministicEmbeddingProviderAdapter(),
  };
  const openAiKey = env.OSVA_KNOWLEDGE_EMBEDDING_API_KEY?.trim();
  if (openAiKey !== undefined && openAiKey.length > 0) {
    providers.OPENAI_COMPATIBLE = new OpenAiCompatibleEmbeddingAdapter({
      provider: "OPENAI_COMPATIBLE",
      apiKey: openAiKey,
      baseURL: env.OSVA_KNOWLEDGE_EMBEDDING_BASE_URL?.trim(),
    });
  }

  const ingestion = new KnowledgeIngestionService({
    knowledge: knowledgeRepository,
    parsers: new OsvaKnowledgeParserRegistry(),
    createArtifact: artifacts.createArtifact,
    openArtifact: artifacts.openArtifactContent,
    embeddings: new EmbeddingGateway({ providers }),
    vectorStore: new PgVectorStore(database),
    clock,
    ids,
    logger: {
      info: logEvent,
      warn: logEvent,
    },
    maxSourceBytes: Math.min(
      artifactStorage.maxBytes,
      KNOWLEDGE_MAX_SOURCE_BYTES,
    ),
    maxExtractedBytes: KNOWLEDGE_MAX_EXTRACTED_BYTES,
  });

  const queue = new BullMqKnowledgeIndexQueue({ url: config.valkeyUrl });

  return {
    config,
    async start() {
      await queue.start(async (knowledgeIndexId) => {
        try {
          await ingestion.processIndex(knowledgeIndexId);
        } catch {
          // durable failure state is persisted on the index
        }
      });
      logEvent("knowledge_worker.started");
    },
    async stop() {
      await queue.stop();
      await database.close();
      logEvent("knowledge_worker.stopped");
    },
  };
}
