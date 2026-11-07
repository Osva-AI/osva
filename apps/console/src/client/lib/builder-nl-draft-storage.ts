const SCHEMA_VERSION = "1" as const;
const STORAGE_PREFIX = "osva.builder.nl";

export interface BuilderNlDraftEnvelopeV1 {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly updatedAt: string;
  readonly instruction: string;
  readonly generationModelProfileVersionId?: string;
  readonly proposal: unknown | null;
  readonly selectedNodeKey?: string;
  readonly validation?: unknown;
  readonly publicationIdempotencyKey?: string;
  readonly publicationReceipt?: unknown;
}

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}.${SCHEMA_VERSION}:${workspaceId}`;
}

export function loadBuilderNlDraft(
  workspaceId: string,
): BuilderNlDraftEnvelopeV1 | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  const raw = sessionStorage.getItem(storageKey(workspaceId));
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as BuilderNlDraftEnvelopeV1;
    if (
      parsed.schemaVersion !== SCHEMA_VERSION ||
      parsed.workspaceId !== workspaceId
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveBuilderNlDraft(envelope: BuilderNlDraftEnvelopeV1): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(
    storageKey(envelope.workspaceId),
    JSON.stringify(envelope),
  );
}

export function clearBuilderNlDraft(workspaceId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(storageKey(workspaceId));
}
