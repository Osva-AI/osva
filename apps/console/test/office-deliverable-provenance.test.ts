import { describe, expect, it } from "vitest";

import type { OfficeAssignmentResource } from "../src/client/hooks/use-office";
import type { ArtifactResource } from "../src/client/hooks/use-runs";
import {
  buildOfficeDeliverableProvenanceContext,
  resolveArtifactOfficeProvenance,
} from "../src/client/lib/office-deliverable-provenance";

const digest = `sha256:${"c".repeat(64)}`;

function assignment(
  overrides: Partial<OfficeAssignmentResource> &
    Pick<OfficeAssignmentResource, "id" | "title">,
): OfficeAssignmentResource {
  return {
    workspaceId: "ws-1",
    officeWorkerId: "ow-1",
    targetType: "AGENT_VERSION",
    targetVersionId: "av-1",
    input: {},
    status: "COMPLETED",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function artifact(
  overrides: Partial<ArtifactResource> & Pick<ArtifactResource, "id" | "name">,
): ArtifactResource {
  return {
    mediaType: "text/plain",
    sizeBytes: 10,
    digest,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("console office deliverable provenance", () => {
  it("resolves agent-backed artifact on the library page", () => {
    const assignments = [
      assignment({
        id: "asn-1",
        title: "Draft",
        goalId: "goal-1",
        runId: "run-1",
      }),
    ];
    const context = buildOfficeDeliverableProvenanceContext(assignments, []);
    const view = resolveArtifactOfficeProvenance(
      artifact({
        id: "art-1",
        name: "out.txt",
        producer: { runId: "run-1", runAttemptId: "ra-1" },
      }),
      context,
    );
    expect(view.task).toEqual({ kind: "verified", assignmentId: "asn-1" });
    expect(view.mission).toEqual({ kind: "verified", goalId: "goal-1" });
  });

  it("labels workspace artifact without verified task", () => {
    const context = buildOfficeDeliverableProvenanceContext([], []);
    const view = resolveArtifactOfficeProvenance(
      artifact({
        id: "art-orphan",
        name: "manual-upload.bin",
        producer: { runId: "run-x", runAttemptId: "ra-x" },
      }),
      context,
    );
    expect(view.task.kind).toBe("none");
    expect(view.mission.kind).toBe("none");
  });
});
