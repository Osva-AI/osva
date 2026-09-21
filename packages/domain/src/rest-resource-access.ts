import type { WorkspaceId } from "@osva/contracts";

/**
 * Pass 2 REST invariant: foreign-workspace resources are not found (404), while
 * in-workspace authorization failures are permission denied (403).
 */
export const REST_RESOURCE_ACCESS_OUTCOME = {
  GRANTED: "granted",
  NOT_FOUND: "not_found",
  PERMISSION_DENIED: "permission_denied",
} as const;

export type RestResourceAccessOutcome =
  (typeof REST_RESOURCE_ACCESS_OUTCOME)[keyof typeof REST_RESOURCE_ACCESS_OUTCOME];

export function classifyRestResourceAccess(params: {
  readonly principalWorkspaceId: WorkspaceId;
  readonly resourceWorkspaceId: WorkspaceId | undefined;
  readonly authorized: boolean;
}): RestResourceAccessOutcome {
  if (params.resourceWorkspaceId === undefined) {
    return REST_RESOURCE_ACCESS_OUTCOME.NOT_FOUND;
  }

  if (params.resourceWorkspaceId !== params.principalWorkspaceId) {
    return REST_RESOURCE_ACCESS_OUTCOME.NOT_FOUND;
  }

  if (!params.authorized) {
    return REST_RESOURCE_ACCESS_OUTCOME.PERMISSION_DENIED;
  }

  return REST_RESOURCE_ACCESS_OUTCOME.GRANTED;
}
