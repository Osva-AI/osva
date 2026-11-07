const SCHEMA_VERSION = "1" as const;
const STORAGE_PREFIX = "osva.builder.nl";
export const BUILDER_NL_MAX_ACCEPTED_REVISIONS = 16;

export interface BuilderNlAcceptedRevisionV1 {
  readonly proposalDigest: string;
  readonly proposal: unknown;
  readonly refinementInstruction?: string;
  readonly acceptedAt: string;
}

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
  /** Bounded accepted revision stack (newest last). M20.5 */
  readonly acceptedRevisions?: readonly BuilderNlAcceptedRevisionV1[];
  /** Short UX-only conversational history (not authoritative). */
  readonly conversationalHistory?: readonly string[];
  /** Pending candidate review persisted across refresh (optional). */
  readonly pendingCandidate?: {
    readonly candidateProposal: unknown;
    readonly changes: unknown;
    readonly baseProposalDigest: string;
    readonly refinementInstruction: string;
  };
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
  const trimmed: BuilderNlDraftEnvelopeV1 = {
    ...envelope,
    acceptedRevisions:
      envelope.acceptedRevisions !== undefined
        ? envelope.acceptedRevisions.slice(-BUILDER_NL_MAX_ACCEPTED_REVISIONS)
        : undefined,
    conversationalHistory:
      envelope.conversationalHistory !== undefined
        ? envelope.conversationalHistory.slice(-8)
        : undefined,
  };
  try {
    sessionStorage.setItem(
      storageKey(envelope.workspaceId),
      JSON.stringify(trimmed),
    );
  } catch {
    // Avoid crashing UI on quota errors.
  }
}

export function clearBuilderNlDraft(workspaceId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(storageKey(workspaceId));
}
