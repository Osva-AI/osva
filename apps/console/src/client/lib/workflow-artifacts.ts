import { consoleFetch } from "./console-api";
import { compareWorkflowNodeRuns } from "./workflow-node-run-overlay";
import {
  orderWorkflowNodeKeys,
  type WorkflowDefinitionView,
} from "./workflow-definition";
import type { ArtifactListResource, ArtifactResource } from "../hooks/use-runs";
import type { WorkflowNodeRunResource } from "../hooks/use-workflow-runs";

export const WORKFLOW_ARTIFACT_PAGE_LIMIT = 100;
export const WORKFLOW_ARTIFACT_MAX_PAGES_PER_RUN = 5;
export const WORKFLOW_ARTIFACT_FETCH_CONCURRENCY = 4;

const ARTIFACT_REFERENCE_TYPE = "artifact";

export interface AgentChildRunRef {
  readonly nodeKey: string;
  readonly childRunId: string;
  readonly sequence: number;
}

export interface ArtifactReferenceV1View {
  readonly type: typeof ARTIFACT_REFERENCE_TYPE;
  readonly artifactId: string;
}

export interface WorkflowArtifactAssociation {
  readonly nodeKey: string;
  readonly childRunId: string;
}

export interface WorkflowAssociatedArtifact {
  readonly artifact: ArtifactResource;
  readonly nodeKey: string;
  readonly childRunId: string;
}

export interface ChildRunArtifactPage {
  readonly childRunId: string;
  readonly nodeKey: string;
  readonly items: readonly ArtifactResource[];
  readonly truncated: boolean;
  readonly error?: unknown;
}

export interface WorkflowRunArtifactsResult {
  readonly items: ArtifactResource[];
  readonly associations: Readonly<Record<string, WorkflowArtifactAssociation>>;
  readonly truncated: boolean;
  readonly failures: readonly string[];
}

export function isAgentNodeType(type: string): boolean {
  return type === "AGENT";
}

export function collectAgentChildRuns(
  definition: WorkflowDefinitionView,
  nodeRuns: readonly WorkflowNodeRunResource[],
): AgentChildRunRef[] {
  const agentKeys = new Set(
    definition.nodes
      .filter((node) => isAgentNodeType(node.type))
      .map((node) => node.key),
  );
  const orderIndex = new Map(
    orderWorkflowNodeKeys(definition).map((key, index) => [key, index]),
  );

  const sorted = [...nodeRuns].sort((left, right) => {
    const leftOrder =
      orderIndex.get(left.workflowNodeKey) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      orderIndex.get(right.workflowNodeKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return compareWorkflowNodeRuns(left, right);
  });

  const seenChildRuns = new Set<string>();
  const refs: AgentChildRunRef[] = [];
  for (const nodeRun of sorted) {
    if (!agentKeys.has(nodeRun.workflowNodeKey)) {
      continue;
    }
    const childRunId = nodeRun.childRunId?.trim();
    if (childRunId === undefined || childRunId.length === 0) {
      continue;
    }
    if (seenChildRuns.has(childRunId)) {
      continue;
    }
    seenChildRuns.add(childRunId);
    refs.push({
      nodeKey: nodeRun.workflowNodeKey,
      childRunId,
      sequence: nodeRun.sequence,
    });
  }
  return refs;
}

export function isArtifactReferenceV1(
  value: unknown,
): value is ArtifactReferenceV1View {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 2) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === ARTIFACT_REFERENCE_TYPE &&
    typeof record.artifactId === "string" &&
    record.artifactId.length > 0
  );
}

export function collectExplicitArtifactReferences(
  outputs: readonly unknown[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const output of outputs) {
    const candidates = [output];
    if (typeof output === "object" && output !== null && "artifact" in output) {
      candidates.push((output as { artifact: unknown }).artifact);
    }
    for (const candidate of candidates) {
      if (isArtifactReferenceV1(candidate) && !seen.has(candidate.artifactId)) {
        seen.add(candidate.artifactId);
        ids.push(candidate.artifactId);
      }
    }
  }
  return ids;
}

export function artifactBelongsToChildRun(
  artifact: ArtifactResource,
  childRunId: string,
): boolean {
  return artifact.producer?.runId === childRunId;
}

export function associateListedArtifacts(
  childRuns: readonly AgentChildRunRef[],
  pages: readonly ChildRunArtifactPage[],
): {
  readonly associated: WorkflowAssociatedArtifact[];
  readonly rejected: number;
} {
  const pageByRun = new Map(
    pages.map((page) => [page.childRunId, page] as const),
  );
  const seen = new Set<string>();
  const associated: WorkflowAssociatedArtifact[] = [];
  let rejected = 0;

  for (const child of childRuns) {
    const page = pageByRun.get(child.childRunId);
    if (page === undefined) {
      continue;
    }
    for (const artifact of page.items) {
      if (seen.has(artifact.id)) {
        continue;
      }
      if (!artifactBelongsToChildRun(artifact, child.childRunId)) {
        rejected += 1;
        continue;
      }
      seen.add(artifact.id);
      associated.push({
        artifact,
        nodeKey: child.nodeKey,
        childRunId: child.childRunId,
      });
    }
  }

  return { associated, rejected };
}

export function sortAssociatedArtifacts(
  associated: readonly WorkflowAssociatedArtifact[],
  definition: WorkflowDefinitionView,
): WorkflowAssociatedArtifact[] {
  const orderIndex = new Map(
    orderWorkflowNodeKeys(definition).map((key, index) => [key, index]),
  );
  return [...associated].sort((left, right) => {
    const leftOrder = orderIndex.get(left.nodeKey) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderIndex.get(right.nodeKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.artifact.createdAt !== right.artifact.createdAt) {
      return left.artifact.createdAt.localeCompare(right.artifact.createdAt);
    }
    return left.artifact.id.localeCompare(right.artifact.id);
  });
}

export function toWorkflowRunArtifactsResult(
  associated: readonly WorkflowAssociatedArtifact[],
  truncated: boolean,
  failures: readonly string[],
): WorkflowRunArtifactsResult {
  const associations: Record<string, WorkflowArtifactAssociation> = {};
  const items: ArtifactResource[] = [];
  for (const entry of associated) {
    items.push(entry.artifact);
    associations[entry.artifact.id] = {
      nodeKey: entry.nodeKey,
      childRunId: entry.childRunId,
    };
  }
  return { items, associations, truncated, failures };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );
  return results;
}

export function artifactListPath(
  runId: string,
  cursor?: string,
  limit = WORKFLOW_ARTIFACT_PAGE_LIMIT,
): string {
  const search = new URLSearchParams({
    runId,
    limit: String(limit),
  });
  if (cursor !== undefined && cursor.length > 0) {
    search.set("cursor", cursor);
  }
  return `/api/v1/artifacts?${search.toString()}`;
}

export async function listArtifactsForChildRun(
  childRunId: string,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchPage?: (
      path: string,
      signal?: AbortSignal,
    ) => Promise<ArtifactListResource>;
  } = {},
): Promise<{ items: ArtifactResource[]; truncated: boolean }> {
  const fetchPage =
    options.fetchPage ??
    ((path, signal) => consoleFetch<ArtifactListResource>(path, { signal }));

  const items: ArtifactResource[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    pages += 1;
    const page = await fetchPage(
      artifactListPath(childRunId, cursor),
      options.signal,
    );
    items.push(...page.items);
    if (page.nextCursor === undefined) {
      return { items, truncated: false };
    }
    if (pages >= WORKFLOW_ARTIFACT_MAX_PAGES_PER_RUN) {
      return { items, truncated: true };
    }
    cursor = page.nextCursor;
  }
}

export async function loadWorkflowRunArtifacts(input: {
  readonly definition: WorkflowDefinitionView;
  readonly childRuns: readonly AgentChildRunRef[];
  readonly referenceIds: readonly string[];
  readonly signal?: AbortSignal;
  readonly fetchPage?: (
    path: string,
    signal?: AbortSignal,
  ) => Promise<ArtifactListResource>;
  readonly fetchArtifact?: (
    artifactId: string,
    signal?: AbortSignal,
  ) => Promise<ArtifactResource>;
}): Promise<WorkflowRunArtifactsResult> {
  const failures: string[] = [];
  const pages = await mapWithConcurrency(
    input.childRuns,
    WORKFLOW_ARTIFACT_FETCH_CONCURRENCY,
    async (child): Promise<ChildRunArtifactPage> => {
      try {
        const listed = await listArtifactsForChildRun(child.childRunId, {
          signal: input.signal,
          fetchPage: input.fetchPage,
        });
        return {
          childRunId: child.childRunId,
          nodeKey: child.nodeKey,
          items: listed.items,
          truncated: listed.truncated,
        };
      } catch (error) {
        failures.push(
          `Could not load artifacts for ${child.nodeKey} (${child.childRunId}).`,
        );
        return {
          childRunId: child.childRunId,
          nodeKey: child.nodeKey,
          items: [],
          truncated: false,
          error,
        };
      }
    },
  );

  const { associated } = associateListedArtifacts(input.childRuns, pages);
  const associatedIds = new Set(associated.map((entry) => entry.artifact.id));
  const childByRunId = new Map(
    input.childRuns.map((child) => [child.childRunId, child] as const),
  );

  const fetchArtifact =
    input.fetchArtifact ??
    ((artifactId, signal) =>
      consoleFetch<ArtifactResource>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
        { signal },
      ));

  for (const artifactId of input.referenceIds) {
    if (associatedIds.has(artifactId)) {
      continue;
    }
    try {
      const artifact = await fetchArtifact(artifactId, input.signal);
      const producerRunId = artifact.producer?.runId;
      if (producerRunId === undefined) {
        continue;
      }
      const child = childByRunId.get(producerRunId);
      if (child === undefined) {
        continue;
      }
      if (!artifactBelongsToChildRun(artifact, child.childRunId)) {
        continue;
      }
      associatedIds.add(artifact.id);
      associated.push({
        artifact,
        nodeKey: child.nodeKey,
        childRunId: child.childRunId,
      });
    } catch {
      failures.push(`Could not resolve artifact reference ${artifactId}.`);
    }
  }

  const truncated = pages.some((page) => page.truncated);
  return toWorkflowRunArtifactsResult(
    sortAssociatedArtifacts(associated, input.definition),
    truncated,
    failures,
  );
}
