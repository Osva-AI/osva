import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("M10.1A acceptance runner", () => {
  it("documents required environment variables in the golden-path README", async () => {
    const readme = await readFile(
      path.join(REPO_ROOT, "examples", "hello-agent", "README.md"),
      "utf8",
    );
    for (const token of [
      "OSVA_BASE_URL",
      "OSVA_API_KEY",
      "OSVA_WORKSPACE_ID",
      "pnpm example:hello",
    ]) {
      assert.match(readme, new RegExp(token.replace(".", "\\.")));
    }
  });
});
