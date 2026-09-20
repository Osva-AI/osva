import { describe, expect, it } from "vitest";

import { ARTIFACT_REFERENCE_TYPE } from "../src/artifact.js";
import { artifactReferenceV1Schema } from "../src/schemas/artifact.js";

describe("artifact contracts", () => {
  it("accepts ArtifactReferenceV1", () => {
    const parsed = artifactReferenceV1Schema.parse({
      type: ARTIFACT_REFERENCE_TYPE,
      artifactId: "artifact-1",
    });
    expect(parsed.type).toBe("artifact");
  });
});
