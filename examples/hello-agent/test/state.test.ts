import { describe, expect, it } from "vitest";

import { assertStateHasNoSecrets } from "../scripts/lib/state.js";

describe("Hello Agent state security", () => {
  it("refuses secret-like keys in persisted state", () => {
    expect(() =>
      assertStateHasNoSecrets({
        schemaVersion: "1",
        workspaceId: "ws-test",
        agentId: "agent-1",
        agentVersionId: "av-1",
        manifestFingerprint: "fp",
        integrity: `sha256:${"a".repeat(64)}`,
        updatedAt: "2026-01-01T00:00:00.000Z",
        apiKey: "osva_ak_secret",
      } as never),
    ).toThrow(/secret/i);
  });

  it("treats corrupt state as absent for recovery", async () => {
    const { mkdir, writeFile, rm } = await import("node:fs/promises");
    const path = await import("node:path");
    const { packageRootDir } = await import("../scripts/lib/constants.js");
    const { readHelloState } = await import("../scripts/lib/state.js");
    const statePath = path.join(
      packageRootDir,
      ".osva",
      "hello-agent-state.json",
    );
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, "{ not-json", "utf8");
    await expect(readHelloState()).resolves.toBeNull();
    await rm(path.dirname(statePath), { recursive: true, force: true });
  });

  it("allows identifier-only state", () => {
    expect(() =>
      assertStateHasNoSecrets({
        schemaVersion: "1",
        workspaceId: "ws-test",
        agentId: "agent-1",
        agentVersionId: "av-1",
        manifestFingerprint: "fp",
        integrity: `sha256:${"a".repeat(64)}`,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).not.toThrow();
  });
});
