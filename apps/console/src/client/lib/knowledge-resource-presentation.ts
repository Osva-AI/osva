import type {
  KnowledgeHitResource,
  KnowledgeIndexResource,
  KnowledgeSourceResource,
} from "../hooks/use-knowledge-memory";

export function describeKnowledgeWriteRoleRequirement(): string {
  return "Creating sources or indexes requires Developer, Admin, or Owner.";
}

export function formatKnowledgeIndexStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Running";
    case "READY":
      return "Ready";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

export type KnowledgeIndexStatusTone =
  "success" | "error" | "warning" | "neutral";

export function knowledgeIndexStatusTone(
  status: string,
): KnowledgeIndexStatusTone {
  if (status === "READY") {
    return "success";
  }
  if (status === "FAILED") {
    return "error";
  }
  if (status === "RUNNING" || status === "PENDING") {
    return "warning";
  }
  return "neutral";
}

export function summarizeKnowledgeIndexPipeline(
  index: KnowledgeIndexResource,
): string {
  return `${index.parserKey}@${index.parserVersion} · ${index.chunkerKey}@${index.chunkerVersion} · chunks ${String(index.chunkSize)}/${String(index.chunkOverlap)} · ${index.embeddingProvider}/${index.embeddingModel} (${String(index.embeddingDimensions)}d ${index.distanceMetric})`;
}

export function summarizeSourceIndexReadiness(
  indexes: readonly KnowledgeIndexResource[],
): {
  readonly total: number;
  readonly readyCount: number;
  readonly latestStatus?: string;
  readonly headline: string;
} {
  if (indexes.length === 0) {
    return { total: 0, readyCount: 0, headline: "Not indexed" };
  }
  const readyCount = indexes.filter((index) => index.status === "READY").length;
  const latest = indexes.reduce((left, right) =>
    new Date(right.createdAt).getTime() > new Date(left.createdAt).getTime()
      ? right
      : left,
  );
  if (readyCount > 0) {
    return {
      total: indexes.length,
      readyCount,
      latestStatus: latest.status,
      headline:
        readyCount === indexes.length
          ? `${String(readyCount)} READY`
          : `${String(readyCount)} READY · ${String(indexes.length)} total`,
    };
  }
  return {
    total: indexes.length,
    readyCount: 0,
    latestStatus: latest.status,
    headline: `Latest: ${formatKnowledgeIndexStatusLabel(latest.status)}`,
  };
}

export function formatKnowledgeIndexSelectLabel(input: {
  readonly source: KnowledgeSourceResource;
  readonly index: KnowledgeIndexResource;
}): string {
  const when = input.index.readyAt ?? input.index.createdAt;
  return `${input.source.name} (${input.source.key}) · ${formatKnowledgeIndexStatusLabel(input.index.status)} · ${new Date(when).toLocaleString()}`;
}

export function formatArtifactPickerLabel(artifact: {
  readonly name: string;
  readonly mediaType: string;
}): string {
  return `${artifact.name} · ${artifact.mediaType}`;
}

export function formatKnowledgeHitLocation(
  hit: KnowledgeHitResource,
): string | undefined {
  const parts: string[] = [];
  if (hit.location?.page !== undefined) {
    parts.push(`page ${String(hit.location.page)}`);
  }
  if (hit.location?.heading !== undefined && hit.location.heading.length > 0) {
    parts.push(hit.location.heading);
  }
  if (hit.location?.sourceSegmentOrdinal !== undefined) {
    parts.push(`segment ${String(hit.location.sourceSegmentOrdinal)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
