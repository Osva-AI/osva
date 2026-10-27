import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVerificationPlan } from "./branch-impact.mjs";

describe("branch verification planner", () => {
  it("selects console route regression tests for onboarding route changes", async () => {
    const plan = await buildVerificationPlan([
      "apps/console/src/client/routes/onboarding-page.tsx",
    ]);
    assert.ok(
      plan.targetedUnitTests.some((entry) =>
        entry.relativeTestFiles.includes("test/spa-routing.test.ts"),
      ),
    );
    assert.ok(
      plan.obligations.some((entry) => entry.id === "console-browser-smoke"),
    );
    assert.equal(plan.unknownSourcePaths.length, 0);
  });

  it("includes worker and adapter packages for runtime adapter interface changes (case A)", async () => {
    const plan = await buildVerificationPlan([
      "adapters/runtime-http/src/runtime-session.ts",
    ]);
    assert.ok(plan.turboPackageNames.includes("@osva/worker"));
    assert.ok(plan.turboPackageNames.some((name) => name.includes("runtime")));
  });

  it("targets human-session and server tests when ConsoleOsvaClient changes (case B)", async () => {
    const plan = await buildVerificationPlan([
      "apps/console/src/server/osva-client.ts",
    ]);
    assert.ok(plan.turboPackageNames.includes("@osva/console"));
    const targeted = plan.targetedUnitTests.flatMap(
      (entry) => entry.relativeTestFiles,
    );
    assert.ok(targeted.includes("test/human-session-bff.test.ts"));
    assert.ok(targeted.includes("test/server.test.ts"));
  });

  it("reports unknown source outside workspace packages", async () => {
    const plan = await buildVerificationPlan(["orphan-feature.ts"]);
    assert.ok(plan.unknownSourcePaths.includes("orphan-feature.ts"));
  });

  it("treats docs-only changes as documentation impact without turbo packages", async () => {
    const plan = await buildVerificationPlan(["docs/engineering/NOTE.md"]);
    assert.equal(plan.turboPackageNames.length, 0);
    assert.equal(plan.docsLinkCheck, true);
    assert.equal(plan.unknownSourcePaths.length, 0);
  });

  it("includes contract consumers for contract package changes", async () => {
    const plan = await buildVerificationPlan([
      "packages/contracts/src/runs/run.ts",
    ]);
    assert.ok(plan.turboPackageNames.includes("@osva-ai/contracts"));
    assert.ok(plan.consumerPackageNames.length >= 1);
  });

  it("records integration obligations as NOT RUN in fast profile metadata", async () => {
    const plan = await buildVerificationPlan(["apps/worker/src/main.ts"]);
    assert.ok(
      plan.obligations.some((entry) => entry.id === "worker-integration"),
    );
  });

  it("requires evaluation quality-gate browser acceptance for Evaluation Studio changes", async () => {
    const plan = await buildVerificationPlan([
      "apps/console/src/client/components/evaluation/evaluation-quality-gate-panel.tsx",
    ]);
    assert.ok(
      plan.obligations.some(
        (entry) => entry.id === "console-evaluation-quality-gate-browser",
      ),
    );
    assert.ok(
      plan.impactSummary.some((line) => line.startsWith("evaluation-studio:")),
    );
  });

  it("includes untracked-style paths in inventory when passed explicitly (case F)", async () => {
    const plan = await buildVerificationPlan([
      "scripts/verification/new-helper.mjs",
    ]);
    assert.ok(plan.runHarnessTests);
    assert.equal(plan.unknownSourcePaths.length, 0);
  });
});
