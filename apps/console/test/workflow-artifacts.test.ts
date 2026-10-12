import { describe, expect, it, vi } from "vitest";

import type {
  ArtifactListResource,
  ArtifactResource,
} from "../src/client/hooks/use-runs";
import type { WorkflowNodeRunResource } from "../src/client/hooks/use-workflow-runs";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";
import {
  WORKFLOW_ARTIFACT_MAX_PAGES_PER_RUN,
  artifactBelongsToChildRun,
  artifactListPath,
  associateListedArtifacts,
  collectAgentChildRuns,
  collectExplicitArtifactReferences,
  isArtifactReferenceV1,
  listArtifactsForChildRun,
  loadWorkflowRunArtifacts,
  mapWithConcurrency,
} from "../src/client/lib/workflow-artifacts";

const digest = `sha256:${"b".repeat(64)}`;

const definition: WorkflowDefinitionView = {
  schemaVersion: "3",
  nodes: [
    { key: "research", type: "AGENT" },
    { key: "approval", type: "APPROVAL" },
    { key: "analysis", type: "AGENT" },
    { key: "wait-event", type: "WAIT" },
    { key: "report", type: "AGENT" },
    { key: "join", type: "JOIN" },
  ],
  edges: [
    { from: "research", to: "approval" },
    { from: "approval", to: "analysis" },
    { from: "analysis", to: "wait-event" },
    { from: "wait-event", to: "report" },
    { from: "report", to: "join" },
  ],
};

function nodeRun(
  overrides: Partial<WorkflowNodeRunResource> &
    Pick<WorkflowNodeRunResource, "id" | "workflowNodeKey" | "sequence">,
): WorkflowNodeRunResource {
  return {
    workspaceId: "ws-1",
    workflowRunId: "wr-1",
    status: "SUCCEEDED",
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function artifact(
  overrides: Partial<ArtifactResource> & Pick<ArtifactResource, "id" | "name">,
): ArtifactResource {
  return {
    mediaType: "text/markdown",
    sizeBytes: 24,
    digest,
    createdAt: "2026-01-01T00:00:00.000Z",
    producer: { runId: "run-report", runAttemptId: "ra-1" },
    ...overrides,
  };
}

describe("collectAgentChildRuns", () => {
  it("keeps AGENT child Runs and ignores APPROVAL, WAIT, and JOIN", () => {
    const refs = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-research",
        workflowNodeKey: "research",
        sequence: 1,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-approval",
        workflowNodeKey: "approval",
        sequence: 2,
        status: "WAITING",
      }),
      nodeRun({
        id: "wn-wait",
        workflowNodeKey: "wait-event",
        sequence: 3,
        childRunId: "should-not-count",
      }),
      nodeRun({
        id: "wn-report",
        workflowNodeKey: "report",
        sequence: 4,
        childRunId: "run-report",
      }),
      nodeRun({
        id: "wn-join",
        workflowNodeKey: "join",
        sequence: 5,
        childRunId: "also-ignored",
      }),
    ]);

    expect(refs.map((ref) => [ref.nodeKey, ref.childRunId])).toEqual([
      ["research", "run-research"],
      ["report", "run-report"],
    ]);
  });

  it("ignores missing child Runs and fetches a duplicate childRunId once", () => {
    const refs = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-old",
        workflowNodeKey: "research",
        sequence: 1,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-new",
        workflowNodeKey: "research",
        sequence: 2,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-pending",
        workflowNodeKey: "analysis",
        sequence: 3,
        status: "PENDING",
      }),
    ]);

    expect(refs).toEqual([
      { nodeKey: "research", childRunId: "run-research", sequence: 1 },
    ]);
  });
});

describe("artifact references", () => {
  it("accepts only contract-valid ArtifactReferenceV1 objects", () => {
    expect(
      isArtifactReferenceV1({
        type: "artifact",
        artifactId: "art-1",
      }),
    ).toBe(true);
    expect(
      isArtifactReferenceV1({
        type: "artifact",
        artifactId: "art-1",
        extra: true,
      }),
    ).toBe(false);
    expect(isArtifactReferenceV1({ artifactId: "art-1" })).toBe(false);
    expect(
      collectExplicitArtifactReferences([
        {
          nested: { artifactId: "nested-id", type: "artifact" },
          artifact: { type: "artifact", artifactId: "from-field" },
        },
        { type: "artifact", artifactId: "direct" },
      ]),
    ).toEqual(["from-field", "direct"]);
  });
});

describe("associateListedArtifacts", () => {
  it("rejects producer mismatches and missing producer metadata", () => {
    const childRuns = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-report",
        workflowNodeKey: "report",
        sequence: 1,
        childRunId: "run-report",
      }),
    ]);
    const { associated, rejected } = associateListedArtifacts(childRuns, [
      {
        childRunId: "run-report",
        nodeKey: "report",
        truncated: false,
        items: [
          artifact({
            id: "ok",
            name: "report.md",
            producer: { runId: "run-report", runAttemptId: "ra-1" },
          }),
          artifact({
            id: "mismatch",
            name: "foreign.md",
            producer: { runId: "run-other", runAttemptId: "ra-9" },
          }),
          artifact({
            id: "orphan",
            name: "orphan.md",
            producer: undefined,
          }),
          artifact({
            id: "ok",
            name: "duplicate.md",
            producer: { runId: "run-report", runAttemptId: "ra-1" },
          }),
        ],
      },
    ]);

    expect(associated.map((entry) => entry.artifact.id)).toEqual(["ok"]);
    expect(associated[0]?.nodeKey).toBe("report");
    expect(rejected).toBe(2);
    expect(
      artifactBelongsToChildRun(
        artifact({
          id: "x",
          name: "x",
          producer: { runId: "run-report", runAttemptId: "ra-1" },
        }),
        "run-report",
      ),
    ).toBe(true);
  });
});

describe("listArtifactsForChildRun", () => {
  it("follows cursors and reports when the page bound is reached", async () => {
    let calls = 0;
    const listed = await listArtifactsForChildRun("run-report", {
      fetchPage: async (path) => {
        calls += 1;
        expect(path).toContain(artifactListPath("run-report").split("&")[0]!);
        return {
          items: [
            artifact({
              id: `page-${calls}`,
              name: `p${calls}.md`,
              producer: { runId: "run-report", runAttemptId: "ra-1" },
            }),
          ],
          nextCursor: `cursor-${calls}`,
        } satisfies ArtifactListResource;
      },
    });

    expect(calls).toBe(WORKFLOW_ARTIFACT_MAX_PAGES_PER_RUN);
    expect(listed.truncated).toBe(true);
    expect(listed.items).toHaveLength(WORKFLOW_ARTIFACT_MAX_PAGES_PER_RUN);
  });

  it("stops when a page has no next cursor", async () => {
    const listed = await listArtifactsForChildRun("run-report", {
      fetchPage: async () => ({
        items: [
          artifact({
            id: "only",
            name: "only.md",
            producer: { runId: "run-report", runAttemptId: "ra-1" },
          }),
        ],
      }),
    });
    expect(listed.truncated).toBe(false);
    expect(listed.items).toHaveLength(1);
  });
});

describe("loadWorkflowRunArtifacts", () => {
  it("loads multiple AGENT nodes, skips empty nodes, and deduplicates fetches", async () => {
    const childRuns = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-research",
        workflowNodeKey: "research",
        sequence: 1,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-research-dup",
        workflowNodeKey: "research",
        sequence: 2,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-analysis",
        workflowNodeKey: "analysis",
        sequence: 3,
        childRunId: "run-analysis",
      }),
      nodeRun({
        id: "wn-report",
        workflowNodeKey: "report",
        sequence: 4,
        childRunId: "run-report",
      }),
    ]);

    const fetchPage = vi.fn(async (path: string) => {
      const url = new URL(path, "http://console.test");
      const runId = url.searchParams.get("runId");
      if (runId === "run-research") {
        return { items: [] };
      }
      if (runId === "run-analysis") {
        return {
          items: [
            artifact({
              id: "notes",
              name: "notes.md",
              producer: { runId: "run-analysis", runAttemptId: "ra-2" },
            }),
          ],
        };
      }
      return {
        items: [
          artifact({
            id: "report",
            name: "report.md",
            mediaType: "text/markdown",
            producer: { runId: "run-report", runAttemptId: "ra-3" },
          }),
        ],
      };
    });

    const result = await loadWorkflowRunArtifacts({
      definition,
      childRuns,
      referenceIds: [],
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.name)).toEqual([
      "notes.md",
      "report.md",
    ]);
    expect(result.associations.notes?.nodeKey).toBe("analysis");
    expect(result.associations.report?.nodeKey).toBe("report");
    expect(result.truncated).toBe(false);
    expect(result.failures).toEqual([]);
  });

  it("keeps successful lists when one child Run fails", async () => {
    const childRuns = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-research",
        workflowNodeKey: "research",
        sequence: 1,
        childRunId: "run-research",
      }),
      nodeRun({
        id: "wn-report",
        workflowNodeKey: "report",
        sequence: 2,
        childRunId: "run-report",
      }),
    ]);

    const result = await loadWorkflowRunArtifacts({
      definition,
      childRuns,
      referenceIds: [],
      fetchPage: async (path) => {
        if (path.includes("run-research")) {
          throw new Error("upstream timeout");
        }
        return {
          items: [
            artifact({
              id: "report",
              name: "report.md",
              producer: { runId: "run-report", runAttemptId: "ra-1" },
            }),
          ],
        };
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.failures[0]).toMatch(/research/);
  });

  it("enriches a contract-valid output reference only when the producer is a child Run", async () => {
    const childRuns = collectAgentChildRuns(definition, [
      nodeRun({
        id: "wn-report",
        workflowNodeKey: "report",
        sequence: 1,
        childRunId: "run-report",
      }),
    ]);

    const fetchArtifact = vi.fn(async (artifactId: string) => {
      if (artifactId === "ref-ok") {
        return artifact({
          id: "ref-ok",
          name: "from-ref.md",
          producer: { runId: "run-report", runAttemptId: "ra-1" },
        });
      }
      if (artifactId === "ref-foreign") {
        return artifact({
          id: "ref-foreign",
          name: "foreign.md",
          producer: { runId: "run-other-ws", runAttemptId: "ra-9" },
        });
      }
      return artifact({
        id: artifactId,
        name: "orphan.md",
        producer: undefined,
      });
    });

    const result = await loadWorkflowRunArtifacts({
      definition,
      childRuns,
      referenceIds: collectExplicitArtifactReferences([
        {
          artifact: { type: "artifact", artifactId: "ref-ok" },
          leftover: { artifactId: "ignored-nested" },
        },
        { type: "artifact", artifactId: "ref-foreign" },
        { type: "artifact", artifactId: "ref-orphan" },
      ]),
      fetchPage: async () => ({ items: [] }),
      fetchArtifact,
    });

    expect(result.items.map((item) => item.id)).toEqual(["ref-ok"]);
    expect(result.associations["ref-ok"]?.childRunId).toBe("run-report");
  });
});

describe("mapWithConcurrency", () => {
  it("does not exceed the worker bound", async () => {
    let current = 0;
    let max = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      current += 1;
      max = Math.max(max, current);
      await Promise.resolve();
      current -= 1;
      return value;
    });
    expect(max).toBeLessThanOrEqual(2);
  });
});
