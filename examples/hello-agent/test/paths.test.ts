import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  agentArtifactPath,
  packageRootDir,
  resolvePackageRoot,
} from "../scripts/lib/paths.js";

describe("Hello Agent package paths", () => {
  it("resolves package root from compiled dist/scripts/lib", () => {
    const distLib = path.join(packageRootDir, "dist", "scripts", "lib");
    expect(resolvePackageRoot(distLib)).toBe(packageRootDir);
  });

  it("resolves package root from source scripts/lib", () => {
    const srcLib = path.join(packageRootDir, "scripts", "lib");
    expect(resolvePackageRoot(srcLib)).toBe(packageRootDir);
  });

  it("points the deploy artifact at dist/agent/hello-agent.js", () => {
    expect(agentArtifactPath).toBe(
      path.join(packageRootDir, "dist", "agent", "hello-agent.js"),
    );
    expect(agentArtifactPath.endsWith(".js")).toBe(true);
    expect(agentArtifactPath).not.toContain(
      `${path.sep}dist${path.sep}agent${path.sep}hello-agent.ts`,
    );
  });
});
