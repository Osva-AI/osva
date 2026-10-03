import {
  KNOWLEDGE_BINDING_POLICY_DOCS,
  MODEL_BINDING_PRIMARY,
  TOOL_BINDING_NPM_DOWNLOADS,
  TOOL_BINDING_NPM_PACKAGE_METADATA,
  researchToolIdempotencyKey,
} from "./shared/bindings.js";
import type { ResearchOutputV1 } from "./shared/contracts.js";
import { EXAMPLE_SCHEMA_VERSION } from "./shared/contracts.js";
import type {
  ResearchAgentContext,
  TrustedKnowledgeHit,
} from "./shared/context.js";
import {
  buildPolicySearchQuery,
  buildResearchSynthesisMessages,
} from "./shared/prompts.js";
import {
  parseNpmDownloadsEvidence,
  parseNpmPackageEvidence,
  parseResearchModelSynthesis,
  parseWorkflowInputV1,
} from "./shared/validate.js";

function mapPolicyEvidence(
  hits: readonly TrustedKnowledgeHit[],
): ResearchOutputV1["research"]["policyEvidence"] {
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
  context: ResearchAgentContext,
): Promise<ResearchOutputV1> {
  const workflowInput = parseWorkflowInputV1(context.input);
  const request =
    typeof context.input === "object" &&
    context.input !== null &&
    "request" in context.input
      ? (context.input as { request: typeof workflowInput.request }).request
      : workflowInput.request;

  const policyHits = await context.knowledge.search(
    KNOWLEDGE_BINDING_POLICY_DOCS,
    buildPolicySearchQuery(request),
    { topK: 5 },
  );

  const npmPackageRaw = await context.tools.invoke(
    TOOL_BINDING_NPM_PACKAGE_METADATA,
    { packageName: request.packageName },
    {
      idempotencyKey: researchToolIdempotencyKey(
        request.requestId,
        "npm_package_metadata",
      ),
    },
  );

  const npmDownloadsRaw = await context.tools.invoke(
    TOOL_BINDING_NPM_DOWNLOADS,
    { packageName: request.packageName, period: "last-month" },
    {
      idempotencyKey: researchToolIdempotencyKey(
        request.requestId,
        "npm_downloads",
      ),
    },
  );

  const npmPackage = parseNpmPackageEvidence(npmPackageRaw);
  const npmDownloads = parseNpmDownloadsEvidence(npmDownloadsRaw);
  const policyEvidence = mapPolicyEvidence(policyHits);

  const modelResult = await context.models.generateText(MODEL_BINDING_PRIMARY, {
    messages: buildResearchSynthesisMessages({
      request,
      policyEvidence,
      npmPackage,
      npmDownloads,
    }),
    maxOutputTokens: 2_048,
  });

  const synthesis = parseResearchModelSynthesis(modelResult.text);

  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request,
    research: {
      packageName: request.packageName,
      policyEvidence,
      externalEvidence: {
        npmPackage,
        npmDownloads,
      },
      findings: [...synthesis.findings],
      warnings: [...synthesis.warnings],
    },
  };
}
