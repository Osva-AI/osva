import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";

import { agentArtifactPath } from "../scripts/lib/constants.js";
import {
  isSha256IntegrityDigest,
  sha256IntegrityOfFile,
} from "../scripts/lib/integrity.js";

describe("Hello Agent integrity", () => {
  it("computes real sha256 digests for the entrypoint", async () => {
    const bytes = await readFile(agentArtifactPath);
    const fromAdapter = sha256IntegrityOf(bytes);
    const fromLocal = await sha256IntegrityOfFile(agentArtifactPath);
    expect(fromLocal).toBe(fromAdapter);
    expect(isSha256IntegrityDigest(fromLocal)).toBe(true);
  });
});
