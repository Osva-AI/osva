import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import { loadEnvironment } from "./environment.mjs";
import { verifyRuntimeImageContents } from "../deployment/verify-runtime-image.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("docker runtime image dependencies", () => {
  it("rejects dev tooling packages in the runtime image when acceptance is enabled", async () => {
    if (process.env.OSVA_DEPLOY_ACCEPTANCE !== "true") {
      console.log(
        "SKIP runtime image dependency test: set OSVA_DEPLOY_ACCEPTANCE=true",
      );
      return;
    }

    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP runtime image dependency test: Docker not found");
      return;
    }

    const image = process.env.OSVA_IMAGE ?? "osva:smoke";
    const output = verifyRuntimeImageContents(image);
    assert.match(output, /runtime-image-deps-ok/);
  });
});
