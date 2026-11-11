import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const configPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../vitest.integration.config.ts",
);

const MIN_HOOK_TIMEOUT_MS = 180_000;
const MIN_TEST_TIMEOUT_MS = 180_000;

describe("MCP integration harness timeouts", () => {
  it("budgets Docker-backed beforeAll hooks for verify:ci contention", () => {
    const source = fs.readFileSync(configPath, "utf8");
    const parseMs = (pattern: RegExp): number => {
      const match = pattern.exec(source);
      expect(match).not.toBeNull();
      return Number(match?.[1]?.replaceAll("_", "") ?? "0");
    };
    expect(parseMs(/hookTimeout:\s*([\d_]+)/)).toBeGreaterThanOrEqual(
      MIN_HOOK_TIMEOUT_MS,
    );
    expect(parseMs(/testTimeout:\s*([\d_]+)/)).toBeGreaterThanOrEqual(
      MIN_TEST_TIMEOUT_MS,
    );
  });
});
