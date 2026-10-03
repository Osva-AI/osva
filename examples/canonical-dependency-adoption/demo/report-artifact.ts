import type {
  ArtifactId,
  RunId,
  WorkflowRunResourceV1,
} from "@osva-ai/contracts";

import type { OperatorApi } from "../scripts/lib/operator-client.js";
import {
  extractReportOutcome,
  indexNodeRuns,
  resolveAgentOutput,
} from "../scripts/lib/workflow-status.js";

export const CANONICAL_REPORT_MARKDOWN_MEDIA_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
]);

/** Canonical demo reports are small Markdown files. */
export const MAX_CANONICAL_REPORT_ARTIFACT_BYTES = 512 * 1024;

export interface SafeReportArtifactMetadata {
  readonly artifactId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly createdAt: string;
  readonly producer?: {
    readonly runId: string;
    readonly runAttemptId: string;
  };
}

export class DemoReportArtifactError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DemoReportArtifactError";
    this.status = status;
  }
}

export interface ResolvedCanonicalReportArtifact {
  readonly artifactId: ArtifactId;
  readonly metadata: SafeReportArtifactMetadata;
}

function toSafeMetadata(
  resource: Awaited<ReturnType<OperatorApi["sdk"]["artifacts"]["get"]>>,
): SafeReportArtifactMetadata {
  return {
    artifactId: resource.id,
    name: resource.name,
    mediaType: resource.mediaType,
    sizeBytes: resource.sizeBytes,
    digest: resource.digest,
    createdAt: resource.createdAt,
    producer:
      resource.producer === undefined
        ? undefined
        : {
            runId: resource.producer.runId,
            runAttemptId: resource.producer.runAttemptId,
          },
  };
}

function assertMarkdownReportArtifact(
  metadata: SafeReportArtifactMetadata,
): void {
  if (!CANONICAL_REPORT_MARKDOWN_MEDIA_TYPES.has(metadata.mediaType)) {
    throw new DemoReportArtifactError(
      "Report artifact media type is not supported for preview.",
      415,
    );
  }
  if (metadata.sizeBytes > MAX_CANONICAL_REPORT_ARTIFACT_BYTES) {
    throw new DemoReportArtifactError(
      "Report artifact exceeds the canonical demo size limit.",
      413,
    );
  }
}

async function resolveReportArtifactId(
  api: OperatorApi,
  run: WorkflowRunResourceV1,
): Promise<{ artifactId: ArtifactId; reportChildRunId: RunId | undefined }> {
  const nodeRunsByKey = indexNodeRuns(run);
  const reportNode = nodeRunsByKey.get("report");
  if (reportNode === undefined) {
    throw new DemoReportArtifactError(
      "Report node not found for workflow run.",
      404,
    );
  }
  if (reportNode.status !== "SUCCEEDED") {
    throw new DemoReportArtifactError(
      "Report artifact is not available yet.",
      404,
    );
  }

  const reportChildRunId = reportNode.childRunId as RunId | undefined;
  const reportOutput = await resolveAgentOutput(api, reportNode);
  const fromReportNode = extractReportOutcome(reportOutput);
  if (fromReportNode === undefined) {
    throw new DemoReportArtifactError(
      "Report node output does not reference an artifact.",
      404,
    );
  }

  if (run.status === "SUCCEEDED" && run.output !== undefined) {
    const fromWorkflow = extractReportOutcome(run.output);
    if (
      fromWorkflow !== undefined &&
      fromWorkflow.artifactId !== fromReportNode.artifactId
    ) {
      throw new DemoReportArtifactError(
        "Report artifact reference mismatch for workflow run.",
        500,
      );
    }
  }

  return {
    artifactId: fromReportNode.artifactId as ArtifactId,
    reportChildRunId,
  };
}

export async function resolveCanonicalReportArtifact(
  api: OperatorApi,
  run: WorkflowRunResourceV1,
): Promise<ResolvedCanonicalReportArtifact> {
  const { artifactId, reportChildRunId } = await resolveReportArtifactId(
    api,
    run,
  );

  let resource: Awaited<ReturnType<OperatorApi["sdk"]["artifacts"]["get"]>>;
  try {
    resource = await api.sdk.artifacts.get(artifactId);
  } catch {
    throw new DemoReportArtifactError("Report artifact not found.", 404);
  }

  const metadata = toSafeMetadata(resource);

  if (
    reportChildRunId !== undefined &&
    metadata.producer !== undefined &&
    metadata.producer.runId !== reportChildRunId
  ) {
    throw new DemoReportArtifactError(
      "Report artifact is not owned by this workflow run.",
      403,
    );
  }

  assertMarkdownReportArtifact(metadata);

  return { artifactId, metadata };
}

export async function readCanonicalReportArtifactContent(
  api: OperatorApi,
  run: WorkflowRunResourceV1,
): Promise<{ metadata: SafeReportArtifactMetadata; content: string }> {
  const resolved = await resolveCanonicalReportArtifact(api, run);
  const downloaded = await api.sdk.artifacts.download(resolved.artifactId);
  const bytes = await readDownloadBodyWithLimit(
    downloaded.body,
    resolved.metadata.sizeBytes,
    MAX_CANONICAL_REPORT_ARTIFACT_BYTES,
  );

  if (bytes.length !== resolved.metadata.sizeBytes) {
    throw new DemoReportArtifactError(
      "Report artifact content size does not match metadata.",
      502,
    );
  }

  return {
    metadata: resolved.metadata,
    content: bytes.toString("utf8"),
  };
}

export async function readCanonicalReportArtifactBytes(
  api: OperatorApi,
  run: WorkflowRunResourceV1,
): Promise<{ metadata: SafeReportArtifactMetadata; bytes: Buffer }> {
  const resolved = await resolveCanonicalReportArtifact(api, run);
  const downloaded = await api.sdk.artifacts.download(resolved.artifactId);
  const bytes = await readDownloadBodyWithLimit(
    downloaded.body,
    resolved.metadata.sizeBytes,
    MAX_CANONICAL_REPORT_ARTIFACT_BYTES,
  );

  if (bytes.length !== resolved.metadata.sizeBytes) {
    throw new DemoReportArtifactError(
      "Report artifact content size does not match metadata.",
      502,
    );
  }

  return { metadata: resolved.metadata, bytes };
}

export function contentDispositionAttachmentFilename(name: string): string {
  const base = name
    .replace(/[/\\]/g, "_")
    .replace(/[\r\n"]/g, "")
    .trim();
  if (base.length === 0) {
    return "report.md";
  }
  return base;
}

async function readDownloadBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  expectedSizeBytes: number,
  maxBytes: number,
): Promise<Buffer> {
  if (body === null) {
    throw new DemoReportArtifactError(
      "Report artifact content is missing.",
      502,
    );
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined || value.length === 0) {
        continue;
      }
      total += value.length;
      if (total > maxBytes) {
        throw new DemoReportArtifactError(
          "Report artifact exceeds the canonical demo size limit.",
          413,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (expectedSizeBytes > 0 && total !== expectedSizeBytes) {
    throw new DemoReportArtifactError(
      "Report artifact content size does not match metadata.",
      502,
    );
  }

  return Buffer.concat(chunks);
}
