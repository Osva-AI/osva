import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { M15_4_STEPS, resolveSteps } from "../lib/steps.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

test("M15.4 acceptance runner documents entry point", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  assert.equal(typeof pkg.scripts["acceptance:m15"], "string");
  assert.match(pkg.scripts["acceptance:m15"], /m15-4\/run\.mjs/);
});

test("default profile excludes Docker-only integration steps", () => {
  const steps = resolveSteps("default", undefined);
  assert.ok(steps.length > 0);
  assert.ok(!steps.some((step) => step.id === "m12-3-cross-capability"));
  assert.ok(steps.some((step) => step.id === "operator-diagnostics-unit"));
  assert.ok(steps.some((step) => step.id === "migration-history-verify"));
});

test("browser profile includes critical Console journeys", () => {
  const steps = resolveSteps("browser", undefined);
  const ids = new Set(steps.map((step) => step.id));
  assert.ok(ids.has("m13-4-onboarding-browser"));
  assert.ok(ids.has("m13-3-agent-studio-browser"));
  assert.ok(ids.has("m13-6-workflow-browser"));
  assert.ok(ids.has("m13-7-5-browser"));
});

test("every step references an existing reuse path or script", () => {
  for (const step of M15_4_STEPS) {
    assert.ok(step.command.length > 0);
    assert.ok(step.reuseNote.length > 0);
  }
});

test("full profile includes RC4 registry optional step", () => {
  const steps = resolveSteps("full", undefined);
  assert.ok(steps.some((step) => step.id === "rc4-registry-npm"));
});
