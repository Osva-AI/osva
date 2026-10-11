import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultClientDistDir } from "../src/server/config.js";

describe("console config", () => {
  it("defaultClientDistDir resolves client output adjacent to the server module", () => {
    const serverModuleDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/server",
    );
    expect(defaultClientDistDir()).toBe(
      path.resolve(serverModuleDir, "../client"),
    );
  });
});
