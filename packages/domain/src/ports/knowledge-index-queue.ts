import type { KnowledgeIndexId } from "@osva/contracts";

export type KnowledgeIndexQueueHandler = (
  knowledgeIndexId: KnowledgeIndexId,
) => Promise<void>;

export interface KnowledgeIndexQueue {
  enqueue(knowledgeIndexId: KnowledgeIndexId): Promise<void>;
  start(handler: KnowledgeIndexQueueHandler): Promise<void>;
  stop(): Promise<void>;
  ping?(): Promise<void>;
}
