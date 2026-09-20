import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { Artifact } from "../src/artifact.js";
import { DomainInvariantError } from "../src/errors.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const WORKSPACE = "ws-1" as WorkspaceId;
const DIGEST = `sha256:${"a".repeat(64)}`;

function baseProps() {
  return {
    id: "artifact-1" as ArtifactId,
    workspaceId: WORKSPACE,
    name: "report.pdf",
    mediaType: "application/pdf",
    sizeBytes: 10,
    digest: DIGEST,
    metadata: {},
    createdAt: NOW,
  };
}

describe("Artifact", () => {
  it("creates a valid artifact", () => {
    const artifact = Artifact.create(baseProps());
    expect(artifact.name).toBe("report.pdf");
  });

  it("rejects invalid digest", () => {
    expect(() =>
      Artifact.create({ ...baseProps(), digest: "sha256:abc" }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects producer Run without Attempt", () => {
    expect(() =>
      Artifact.create({
        ...baseProps(),
        producerRunId: "run-1" as never,
      }),
    ).toThrow(DomainInvariantError);
  });
});
