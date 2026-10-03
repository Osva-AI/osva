import { Readable } from "node:stream";

import {
  MODEL_BINDING_PRIMARY,
  reportArtifactIdempotencyKey,
} from "./shared/bindings.js";
import type { ReportOutputV1 } from "./shared/contracts.js";
import { EXAMPLE_SCHEMA_VERSION } from "./shared/contracts.js";
import type { ReportAgentContext } from "./shared/context.js";
import {
  buildReportMarkdownMessages,
  sanitizePackageNameForFilename,
} from "./shared/prompts.js";
import { parseAnalysisOutputV1 } from "./shared/validate.js";

export async function run(
  context: ReportAgentContext,
): Promise<ReportOutputV1> {
  const analysisInput = parseAnalysisOutputV1(context.input);
  const { request, analysis } = analysisInput;

  const modelResult = await context.models.generateText(MODEL_BINDING_PRIMARY, {
    messages: buildReportMarkdownMessages(analysisInput),
    maxOutputTokens: 4_096,
  });

  const markdown = modelResult.text.trim();
  if (markdown.length === 0) {
    throw new Error("Report model returned empty Markdown.");
  }

  const safePackage = sanitizePackageNameForFilename(request.packageName);
  const artifactName = `dependency-adoption-review-${safePackage}-${request.requestId}.md`;

  const artifact = await context.artifacts.create(
    artifactName,
    Readable.from([markdown]),
    {
      mediaType: "text/markdown",
      metadata: {
        kind: "osva.canonical.dependency-adoption-review",
        schemaVersion: EXAMPLE_SCHEMA_VERSION,
        requestId: request.requestId,
        packageName: request.packageName,
      },
      idempotencyKey: reportArtifactIdempotencyKey(request.requestId),
    },
  );

  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    requestId: request.requestId,
    disposition: analysis.disposition,
    summary: analysis.summary,
    artifact: {
      type: "artifact",
      artifactId: artifact.reference.artifactId,
    },
  };
}
