import { randomUUID } from "node:crypto";

import {
  createArtifactBlobStore,
  loadArtifactStorageConfig,
} from "@osva/adapters-artifact-storage";
import type { ArtifactBlobStore } from "@osva-ai/contracts";
import { BullMqKnowledgeIndexQueue } from "@osva/adapters-bullmq";
import {
  createOpenTelemetryLifecycle,
  type OpenTelemetryLifecycle,
} from "@osva/adapters-opentelemetry";
import { OpenAiCompatibleEmbeddingAdapter } from "@osva/adapters-embedding-openai-compatible";
import { OsvaKnowledgeParserRegistry } from "@osva/adapters-knowledge-parser";
import { PgVectorStore } from "@osva/adapters-vector-pgvector";
import {
  KNOWLEDGE_MAX_EXTRACTED_BYTES,
  KNOWLEDGE_MAX_SOURCE_BYTES,
} from "@osva-ai/contracts";
import {
  assertPostgresAndValkeyReady,
  checkDatabaseConnection,
  createDatabase,
  startProcessProbeServer,
  type ProcessProbeServer,
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

export interface KnowledgeWorkerProcessDependencies {
  readonly telemetry?: OpenTelemetryLifecycle;
  readonly artifactBlobStore?: ArtifactBlobStore;
}

export function createKnowledgeWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
  dependencies: KnowledgeWorkerProcessDependencies = {},
): KnowledgeWorkerProcess {
  const config = loadKnowledgeWorkerConfig(env);
  const telemetryLifecycle =
    dependencies.telemetry ??
    createOpenTelemetryLifecycle(env, {
      defaultServiceName: "osva-knowledge-worker",
    });
  const artifactStorage = loadArtifactStorageConfig(env);
  const database = databaseFactory(config.databaseUrl);
  const knowledgeRepository = new PostgresKnowledgeRepository(database);
  const artifactsRepository = new PostgresArtifactRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const runs = new PostgresRunRepository(database);
  const blobStore =
    dependencies.artifactBlobStore ?? createArtifactBlobStore(artifactStorage);
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
  let probeServer: ProcessProbeServer | undefined;
  const readinessCheck = async () => {
    await assertPostgresAndValkeyReady(
      database,
      queue,
      checkDatabaseConnection,
    );
  };

  return {
    config,
    async start() {
      await readinessCheck();
      await queue.start(async (knowledgeIndexId) => {
        try {
          await ingestion.processIndex(knowledgeIndexId);
        } catch {
          // durable failure state is persisted on the index
        }
      });
      probeServer = await startProcessProbeServer({
        host: config.health.host,
        port: config.health.port,
        readinessCheck,
      });
      logEvent("knowledge_worker.started");
    },
    async stop() {
      if (probeServer !== undefined) {
        await probeServer.close();
        probeServer = undefined;
      }
      await queue.stop();
      await database.close();
      await telemetryLifecycle.shutdown();
      logEvent("knowledge_worker.stopped");
    },
  };
}
