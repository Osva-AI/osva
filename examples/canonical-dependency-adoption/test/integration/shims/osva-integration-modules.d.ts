declare module "../../../../apps/knowledge-worker/test/integration/knowledge-stack.js" {
  import type { Database } from "@osva/db";
  import type { KnowledgeIndexId, WorkspaceId } from "@osva-ai/contracts";

  export const TEST_EMBEDDING_DEFAULTS: {
    readonly dimensions: number;
    readonly model: string;
  };

  export function createKnowledgeIntegrationStack(
    database: Database,
    options: unknown,
  ): Promise<{
    knowledgeApp: unknown;
    ingestion: { processIndex(id: KnowledgeIndexId): Promise<void> };
    knowledge: {
      findIndexById(id: KnowledgeIndexId): Promise<{ status: string } | null>;
    };
  }>;

  export function integrationControlPlaneScope(
    workspaceId: WorkspaceId,
  ): unknown;
  export function uploadTextArtifact(
    ...args: unknown[]
  ): Promise<{ id: string }>;
}

declare module "../../../../apps/web/src/process.js" {
  export function createWebProcess(...args: unknown[]): {
    listen(): Promise<number>;
    stop(): Promise<void>;
  };
}

declare module "../../../../apps/worker/src/process.js" {
  export function createWorkerProcess(...args: unknown[]): {
    start(): Promise<void>;
    stop(): Promise<void>;
  };
}

declare module "../../../../apps/workflow-orchestrator/src/process.js" {
  export function createWorkflowOrchestratorProcess(...args: unknown[]): {
    tickOnce(): Promise<void>;
    stop(): Promise<void>;
  };
}

declare module "../../../../apps/worker/test/integration/integration-auth.js" {
  export const integrationAuth: { token: string };
  export function bootstrapIntegrationAuth(...args: unknown[]): Promise<void>;
  export function fetchJson(
    url: string,
    init?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

declare module "../../../../packages/db/test/integration/postgres-harness.js" {
  import type { Database } from "@osva/db";

  export interface PostgresTestContext {
    readonly connectionString: string;
    readonly usingDocker: boolean;
  }

  export function startPostgresForTests(): Promise<PostgresTestContext>;
  export function stopPostgresForTests(
    context: PostgresTestContext | undefined,
  ): Promise<void>;
  export function resetStage0Tables(database: Database): Promise<void>;
}

declare module "../../../../adapters/bullmq/test/integration/valkey-harness.js" {
  export interface ValkeyTestContext {
    readonly url: string;
    readonly usingDocker: boolean;
  }

  export function startValkeyForTests(): Promise<ValkeyTestContext>;
  export function stopValkeyForTests(context: ValkeyTestContext): Promise<void>;
}
