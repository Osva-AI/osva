import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/openai-builder-schema-probe.mjs",
);

function runMockedProbe() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probeScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE: "1",
        OSVA_M20_7_OPENAI_SCHEMA_PROBE_MOCK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe("openai-builder-schema-probe exit handling", () => {
  it("exits 1 on mocked provider 400 without libuv assertion crash", async () => {
    const result = await runMockedProbe();
    assert.equal(result.signal, null);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /"outcome": "provider_error"/);
    assert.match(result.stdout, /"httpStatus": 400/);
    assert.doesNotMatch(result.stderr, /UV_HANDLE_CLOSING/);
  });
});
