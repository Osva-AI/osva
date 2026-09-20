import type {
  ExecutionRequest,
  KnowledgeHitV1,
  KnowledgeSearchRequestV1,
} from "@osva/contracts";
import { KnowledgeBindingNotFoundError } from "./errors.js";
import type { KnowledgeRetriever } from "./knowledge-retriever.js";

export interface RuntimeKnowledgeGatewayDependencies {
  readonly retriever: KnowledgeRetriever;
}

/**
 * Resolves frozen knowledge bindings for a Run and delegates retrieval to
 * KnowledgeRetriever. Runtimes never supply KnowledgeIndex IDs directly.
 */
export class RuntimeKnowledgeGateway {
  constructor(private readonly deps: RuntimeKnowledgeGatewayDependencies) {}

  async search(
    execution: ExecutionRequest,
    bindingName: string,
    request: KnowledgeSearchRequestV1,
  ): Promise<readonly KnowledgeHitV1[]> {
    const indexIds = execution.knowledgeIndexBindings[bindingName];
    if (indexIds === undefined || indexIds.length === 0) {
      throw new KnowledgeBindingNotFoundError(bindingName);
    }

    return this.deps.retriever.retrieve({
      workspaceId: execution.workspaceId,
      knowledgeIndexIds: indexIds,
      query: request.query,
      topK: request.topK,
      filter: request.filter,
    });
  }
}
