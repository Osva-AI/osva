import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBuiltClientAssets } from "./read-built-client-assets.js";

describe("readBuiltClientAssets", () => {
  it("fails clearly when the client bundle has not been built", () => {
    const missingRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "__fixtures__",
      "no-dist",
    );
    expect(() => readBuiltClientAssets(missingRoot)).toThrow(
      /Console client bundle is missing/,
    );
    expect(() => readBuiltClientAssets(missingRoot)).toThrow(
      /pnpm --filter @osva\/console build/,
    );
  });
});
