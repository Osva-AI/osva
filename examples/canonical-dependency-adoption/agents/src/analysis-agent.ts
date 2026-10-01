import {
  KNOWLEDGE_BINDING_POLICY_DOCS,
  MODEL_BINDING_PRIMARY,
} from "./shared/bindings.js";
import type { AnalysisOutputV1 } from "./shared/contracts.js";
import { EXAMPLE_SCHEMA_VERSION } from "./shared/contracts.js";
import type {
  AnalysisAgentContext,
  TrustedKnowledgeHit,
} from "./shared/context.js";
import {
  buildAnalysisMessages,
  buildAnalysisPolicySearchQuery,
} from "./shared/prompts.js";
import {
  parseAnalysisRecommendation,
  parseResearchOutputV1,
} from "./shared/validate.js";

function mapPolicyEvidence(hits: readonly TrustedKnowledgeHit[]) {
  return hits.map((hit) => ({
    knowledgeChunkId: hit.knowledgeChunkId,
    knowledgeSourceId: hit.knowledgeSourceId,
    score: hit.score,
    ...(hit.location?.heading !== undefined
      ? { heading: hit.location.heading }
      : {}),
    excerpt: hit.text,
  }));
}

export async function run(
  context: AnalysisAgentContext,
): Promise<AnalysisOutputV1> {
  const researchInput = parseResearchOutputV1(context.input);
  const request =
    typeof context.input === "object" &&
    context.input !== null &&
    "request" in context.input
      ? (context.input as { request: typeof researchInput.request }).request
      : researchInput.request;
  const research =
    typeof context.input === "object" &&
    context.input !== null &&
    "research" in context.input
      ? (context.input as { research: typeof researchInput.research }).research
      : researchInput.research;

  const policyHits = await context.knowledge.search(
    KNOWLEDGE_BINDING_POLICY_DOCS,
    buildAnalysisPolicySearchQuery(request),
    { topK: 5 },
  );

  const modelResult = await context.models.generateText(MODEL_BINDING_PRIMARY, {
    messages: buildAnalysisMessages({
      request,
      researchJson: JSON.stringify({ request, research }, null, 2),
      policyEvidence: mapPolicyEvidence(policyHits),
    }),
    maxOutputTokens: 2_048,
  });

  const analysis = parseAnalysisRecommendation(modelResult.text);

  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request,
    research,
    analysis,
  };
}
