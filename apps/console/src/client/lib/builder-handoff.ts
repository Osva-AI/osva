export interface BuilderHandoff {
  readonly agentId?: string;
  readonly agentVersionId?: string;
}

export function parseBuilderHandoff(
  searchParams: URLSearchParams,
): BuilderHandoff {
  const agentId = optionalId(searchParams.get("agentId"));
  const agentVersionId = optionalId(searchParams.get("agentVersionId"));
  return { agentId, agentVersionId };
}

export function builderHandoffSearch(handoff: BuilderHandoff): string {
  const params = new URLSearchParams();
  if (handoff.agentId !== undefined) {
    params.set("agentId", handoff.agentId);
  }
  if (handoff.agentVersionId !== undefined) {
    params.set("agentVersionId", handoff.agentVersionId);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

function optionalId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
