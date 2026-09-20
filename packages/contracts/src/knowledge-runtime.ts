import type { JsonObject } from "./json-value.js";
import type { KnowledgeHitV1 } from "./knowledge.js";

/** Logical knowledge binding names in AgentManifest and runtime context. */
export const KNOWLEDGE_BINDING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const KNOWLEDGE_MAX_MANIFEST_BINDINGS = 32;
export const KNOWLEDGE_MAX_INDEX_IDS_PER_BINDING = 32;

export function isKnowledgeBindingName(value: string): boolean {
  return KNOWLEDGE_BINDING_NAME_PATTERN.test(value);
}

export interface KnowledgeSearchRequestV1 {
  readonly query: string;
  readonly topK?: number;
  readonly filter?: JsonObject;
}

export interface RuntimeKnowledgeCapability {
  search(
    bindingName: string,
    request: KnowledgeSearchRequestV1,
  ): Promise<readonly KnowledgeHitV1[]>;
}
