import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { deriveComposeProjectName } from "../../m16-shared/compose-project.mjs";
import { bootstrapPlatform111Install } from "../lib/bootstrap-platform-111.mjs";

describe("bootstrapPlatform111Install", () => {
  it("produces compose config that docker compose can parse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "osva-m16-111-compose-"));
    await bootstrapPlatform111Install({
      installDir: dir,
      imageRef: "ghcr.io/osva-ai/osva:1.1.1",
      webPort: 18082,
      mcpPort: 13102,
      consolePort: 4182,
    });
    const marker = JSON.parse(
      await readFile(path.join(dir, ".osva", "installation.json"), "utf8"),
    );
    assert.equal(marker.platformVersion, "1.1.1");
    assert.equal(marker.composeProjectName, deriveComposeProjectName(dir));
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
