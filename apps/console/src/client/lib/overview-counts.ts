/**
 * Registry list endpoints return the full workspace collection (no cursor).
 * Run list endpoints are paginated; never treat page length as a workspace total.
 */

export interface RegistryCountPresentation {
  readonly value: number | undefined;
  readonly label: string;
  readonly detail: string;
}

export function presentRegistryCount(
  count: number | undefined,
  resourceLabel: string,
): RegistryCountPresentation {
  if (count === undefined) {
    return {
      value: undefined,
      label: resourceLabel,
      detail: "Not loaded",
    };
  }
  return {
    value: count,
    label: resourceLabel,
    detail: `All ${resourceLabel.toLowerCase()} in this workspace (full registry list).`,
  };
}

export interface RecentListPresentation {
  readonly shown: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly label: string;
}

export function presentRecentList(
  itemCount: number,
  limit: number,
  nextCursor: string | undefined,
  resourceLabel: string,
): RecentListPresentation {
  return {
    shown: itemCount,
    limit,
    hasMore: nextCursor !== undefined && nextCursor.length > 0,
    label: resourceLabel,
  };
}
