import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Console configuration consumers", () => {
  it("documents human mode as the default in engineering console guide", () => {
    const doc = readRepoFile("docs/engineering/CONSOLE.md");
    expect(doc).toMatch(/human session/i);
    expect(doc).toMatch(/OSVA_CONSOLE_LEGACY_API_KEY_MODE/);
    expect(doc).not.toMatch(/OSVA_CONSOLE_API_KEY.*required/i);
  });

  it("keeps env example on human mode defaults", () => {
    const example = readRepoFile(".env.example");
    expect(example).toMatch(/OSVA_CONSOLE_LEGACY_API_KEY_MODE/);
    expect(example).not.toMatch(/OSVA_CONSOLE_API_KEY=.*required/i);
  });

  it("classifies deployment configuration without mandatory console API key", () => {
    const deployment = readRepoFile("docs/deployment/CONFIGURATION.md");
    expect(deployment).toMatch(/OSVA_CONSOLE_LEGACY_API_KEY_MODE/);
    expect(deployment).toMatch(/legacy only|Legacy|human sessions/i);
  });

  it("preserves legacy integration harness as explicit opt-in", () => {
    const legacy = readRepoFile(
      "apps/console/test/integration/console-real-stack.integration.test.ts",
    );
    expect(legacy).toContain("legacyApiKeyMode: true");
    expect(legacy).toContain("osvaApiKey:");
  });
});
