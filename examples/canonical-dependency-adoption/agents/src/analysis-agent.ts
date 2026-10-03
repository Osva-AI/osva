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
import { CanonicalAgentError } from "./shared/errors.js";
import {
  buildAnalysisMessages,
  buildAnalysisPolicySearchQuery,
  buildAnalysisRepairMessages,
} from "./shared/prompts.js";
import {
  parseAnalysisRecommendation,
  parseResearchOutputV1,
} from "./shared/validate.js";

const MAX_ANALYSIS_MODEL_CALLS = 2;

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

function tryParseAnalysisModelText(text: string):
  | {
      readonly ok: true;
      readonly analysis: ReturnType<typeof parseAnalysisRecommendation>;
    }
  | {
      readonly ok: false;
      readonly error: CanonicalAgentError;
    } {
  try {
    return {
      ok: true,
      analysis: parseAnalysisRecommendation(text),
    };
  } catch (error) {
    if (error instanceof CanonicalAgentError) {
      return { ok: false, error };
    }
    throw error;
  }
}

async function generateAnalysisRecommendation(
  context: AnalysisAgentContext,
  initialMessages: ReturnType<typeof buildAnalysisMessages>,
): Promise<ReturnType<typeof parseAnalysisRecommendation>> {
  const firstResult = await context.models.generateText(MODEL_BINDING_PRIMARY, {
    messages: initialMessages,
    maxOutputTokens: 2_048,
  });

  const firstParsed = tryParseAnalysisModelText(firstResult.text);
  if (firstParsed.ok) {
    return firstParsed.analysis;
  }

  const repairResult = await context.models.generateText(
    MODEL_BINDING_PRIMARY,
    {
      messages: buildAnalysisRepairMessages({
        validationError: firstParsed.error.message,
        previousResponse: firstResult.text,
      }),
      maxOutputTokens: 2_048,
    },
  );

  const repairedParsed = tryParseAnalysisModelText(repairResult.text);
  if (repairedParsed.ok) {
    return repairedParsed.analysis;
  }

  throw repairedParsed.error;
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

  const analysis = await generateAnalysisRecommendation(
    context,
    buildAnalysisMessages({
      request,
      researchJson: JSON.stringify({ request, research }, null, 2),
      policyEvidence: mapPolicyEvidence(policyHits),
    }),
  );

  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request,
    research,
    analysis,
  };
}

export { MAX_ANALYSIS_MODEL_CALLS };
