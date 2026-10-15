import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { agentArtifactPath, packageRootDir } from "../scripts/lib/paths.js";
import {
  assertHelloAgentBuildArtifactsExist,
  missingHelloAgentArtifactError,
} from "../scripts/lib/deploy.js";

describe("Hello Agent build artifacts", () => {
  it("requires the compiled executable after build", async () => {
    await expect(access(agentArtifactPath)).resolves.toBeUndefined();
  });

  it("reports a missing executable with a build hint", () => {
    const missingPath = path.join(
      packageRootDir,
      "dist",
      "agent",
      "hello-agent.js",
    );
    expect(missingHelloAgentArtifactError(missingPath).message).toMatch(
      /missing at .*hello-agent\.js.*build/i,
    );
  });

  it("guard succeeds when dist/agent/hello-agent.js exists", async () => {
    await expect(
      assertHelloAgentBuildArtifactsExist(),
    ).resolves.toBeUndefined();
  });
});
