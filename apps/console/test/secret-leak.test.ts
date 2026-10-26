import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBuiltClientAssets } from "./read-built-client-assets.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("console frontend secret isolation", () => {
  it("does not embed OSVA_CONSOLE_API_KEY in built client assets", () => {
    const combined = readBuiltClientAssets(packageRoot);
    expect(combined).not.toContain("OSVA_CONSOLE_API_KEY");
    expect(combined).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
  });
});
