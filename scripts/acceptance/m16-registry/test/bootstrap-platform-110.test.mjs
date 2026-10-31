import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { deriveComposeProjectName } from "../../m16-shared/compose-project.mjs";
import {
  bootstrapPlatform110Install,
  transformLegacyComposeForPublishedImage,
} from "../lib/bootstrap-platform-110.mjs";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/compose-platform-1.1.0.yml",
);

describe("transformLegacyComposeForPublishedImage", () => {
  it("removes the full build stanza without leaving orphan keys", async () => {
    const raw = await readFile(FIXTURE, "utf8");
    const yaml = transformLegacyComposeForPublishedImage(raw);
    assert.equal(yaml.includes("build:"), false);
    assert.equal(yaml.includes("dockerfile:"), false);
    assert.equal(yaml.includes("context:"), false);
    assert.match(yaml, /image: \$\{OSVA_IMAGE:\?OSVA_IMAGE is required\}/);
  });

  it("produces compose config that docker compose can parse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "osva-m16-compose-test-"));
    await bootstrapPlatform110Install({
      installDir: dir,
      imageRef: "ghcr.io/osva-ai/osva:1.1.0",
      webPort: 18081,
      mcpPort: 13101,
    });
    const env = await readFile(path.join(dir, ".env"), "utf8");
    assert.match(env, /^OSVA_VALKEY_URL=redis:\/\/valkey:6379$/m);
    const marker = JSON.parse(
      await readFile(path.join(dir, ".osva", "installation.json"), "utf8"),
    );
    assert.equal(marker.composeProjectName, deriveComposeProjectName(dir));
    assert.match(
      env,
      new RegExp(`^COMPOSE_PROJECT_NAME=${marker.composeProjectName}$`, "m"),
    );
    const config = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        dir,
        "--env-file",
        path.join(dir, ".env"),
        "config",
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      config.status,
      0,
      config.stderr || config.stdout || "docker compose config failed",
    );
  });
});
