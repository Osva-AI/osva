import assert from "node:assert/strict";
import test from "node:test";

import {
  budgetExceeded,
  createBudgetUsageState,
  loadAndValidateBudgetFromEnv,
  reconcileAfterProviderRequest,
  reserveBeforeProviderRequest,
} from "../lib/budgets.mjs";
import {
  evaluateLivePreflight,
  isCiEnvironment,
  liveExecuteBlockedReason,
} from "../lib/live-guards.mjs";
import {
  M20_7_DEFAULT_GEMINI_MODEL,
  geminiModelLivePreflightError,
} from "../lib/gemini-model-lifecycle.mjs";
import {
  classifyProviderDestination,
  isForbiddenFakeOrigin,
  liveEndpointRejectedReason,
} from "../lib/provider-routing.mjs";
import {
  createEmptyProvenance,
  deriveLiveProviderCallsFlag,
  recordProviderInvocation,
} from "../lib/provenance.mjs";
import { scoreLiveIntent } from "../lib/intent-scoring.mjs";
import {
  deriveOverallStatusFromScenarios,
  liveAcceptanceShouldExitNonZero,
} from "../lib/acceptance-status.mjs";
import { assertLiveReportConsistency } from "../lib/report.mjs";
import { redactAcceptanceSecrets } from "../../m20-6/lib/redaction.mjs";

test("C: missing OSVA_M20_7_LIVE blocks preflight", () => {
  const r = evaluateLivePreflight({}, { provider: "openai" });
  assert.equal(r.ok, false);
});

test("I: missing cost cap blocks live preflight", () => {
  const r = evaluateLivePreflight(
    {
      OSVA_M20_7_LIVE: "1",
      OSVA_M20_7_ISOLATED: "1",
      OPENAI_API_KEY: "sk-test",
    },
    { provider: "openai" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /MAX_COST/);
  }
});

test("J: request budget stops next reservation", () => {
  const { config } = loadAndValidateBudgetFromEnv(
    {
      OSVA_M20_7_MAX_BUILDER_REQUESTS: "1",
      OSVA_M20_7_MAX_COST_USD_MICROS: "10000000",
    },
    { live: true, smoke: true },
  );
  const usage = createBudgetUsageState();
  assert.equal(
    reserveBeforeProviderRequest(usage, config, {
      modelId: "gpt-4o-mini",
      kind: "builder",
    }),
    undefined,
  );
  assert.equal(
    reserveBeforeProviderRequest(usage, config, {
      modelId: "gpt-4o-mini",
      kind: "builder",
    }),
    "MAX_BUILDER_REQUESTS",
  );
});

test("K/L: token/cost budget stops invocation", () => {
  const { config } = loadAndValidateBudgetFromEnv(
    {
      OSVA_M20_7_MAX_PROVIDER_INVOCATIONS: "4",
      OSVA_M20_7_MAX_COST_USD_MICROS: "1",
    },
    { live: true, smoke: true },
  );
  const usage = createBudgetUsageState();
  const blocked = reserveBeforeProviderRequest(usage, config, {
    modelId: "gpt-4o",
    kind: "provider",
  });
  assert.equal(blocked, "MAX_ESTIMATED_COST");
});

test("O: missing usage is not zero cost under cap", () => {
  const { config } = loadAndValidateBudgetFromEnv(
    { OSVA_M20_7_MAX_COST_USD_MICROS: "5000000" },
    { live: true, smoke: true },
  );
  const usage = createBudgetUsageState();
  usage.reservedCostUsdMicros = 1000;
  reconcileAfterProviderRequest(
    usage,
    { modelId: "gpt-4o-mini", success: true },
    config,
  );
  assert.equal(usage.usageMissingTreatedAsUnknown, true);
});

test("provenance fail closed without verified calls", () => {
  const p = createEmptyProvenance();
  assert.equal(deriveLiveProviderCallsFlag(p), false);
  recordProviderInvocation(p, {
    requested: true,
    authorized: true,
    provider: "openai",
    modelId: "gpt-4o-mini",
    endpointBaseUrl: "http://127.0.0.1:1234",
    forbiddenOrigins: ["http://127.0.0.1:1234"],
    invocationSucceeded: true,
  });
  assert.equal(p.verificationCode, "FAKE_PROVIDER_FALLBACK");
  assert.equal(deriveLiveProviderCallsFlag(p), false);
});

test("official endpoint verifies identity on success", () => {
  const p = createEmptyProvenance();
  recordProviderInvocation(p, {
    requested: true,
    authorized: true,
    provider: "openai",
    modelId: "gpt-4o-mini",
    endpointBaseUrl: "https://api.openai.com/v1",
    invocationSucceeded: true,
    providerRequestId: "resp_abcdefghijklmnop",
  });
  assert.equal(deriveLiveProviderCallsFlag(p), true);
});

test("Q: skipped matrix cannot report PASS in live report", () => {
  assert.throws(() =>
    assertLiveReportConsistency({
      mode: "live",
      overallStatus: "PASS",
      liveProviderCalls: false,
      liveExecuteAttempted: true,
    }),
  );
});

test("T: secrets redacted", () => {
  const out = redactAcceptanceSecrets("Bearer sk-live.secret.value");
  assert.ok(!out.includes("sk-live"));
});

test("routing blocks fake origin in live", () => {
  assert.equal(
    liveEndpointRejectedReason({
      baseUrl: "http://127.0.0.1:9",
      forbiddenOrigins: ["http://127.0.0.1:9"],
    }),
    "FAKE_PROVIDER_ENDPOINT_IN_LIVE_MODE",
  );
});

test("retired gemini-2.0-flash blocked at preflight", () => {
  assert.equal(
    geminiModelLivePreflightError("gemini-2.0-flash"),
    "RETIRED_GEMINI_MODEL:gemini-2.0-flash",
  );
  const r = evaluateLivePreflight(
    {
      OSVA_M20_7_LIVE: "1",
      OSVA_M20_7_ISOLATED: "1",
      GOOGLE_GEMINI_API_KEY: "test-gemini",
      OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
      OSVA_M20_7_GENERATION_MODEL: "gemini-2.0-flash",
    },
    { provider: "gemini" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /RETIRED_GEMINI_MODEL/);
  }
});

test("default gemini model accepted at preflight", () => {
  const r = evaluateLivePreflight(
    {
      OSVA_M20_7_LIVE: "1",
      OSVA_M20_7_ISOLATED: "1",
      GOOGLE_GEMINI_API_KEY: "test-gemini",
      OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
    },
    { provider: "gemini" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.modelId, M20_7_DEFAULT_GEMINI_MODEL);
  }
});

test("fixture model ids rejected in preflight", () => {
  const r = evaluateLivePreflight(
    {
      OSVA_M20_7_LIVE: "1",
      OSVA_M20_7_ISOLATED: "1",
      OPENAI_API_KEY: "sk-test",
      OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
      OSVA_M20_7_GENERATION_MODEL: "gpt-m20-6-gen",
    },
    { provider: "openai" },
  );
  assert.equal(r.ok, false);
});

test("CI blocks live unless explicit override", () => {
  assert.equal(isCiEnvironment({ CI: "true" }), true);
  const blocked = liveExecuteBlockedReason({
    CI: "true",
    OSVA_M20_7_LIVE: "1",
    OSVA_M20_7_ISOLATED: "1",
    OPENAI_API_KEY: "sk-test",
    OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
    OSVA_M20_7_LIVE_EXECUTE: "1",
    OSVA_M20_7_ALLOW_BILLABLE: "1",
  });
  assert.equal(blocked, "CI_LIVE_BLOCKED");
});

test("billable execution requires ALLOW_BILLABLE", () => {
  const blocked = liveExecuteBlockedReason({
    OSVA_M20_7_LIVE: "1",
    OSVA_M20_7_ISOLATED: "1",
    OPENAI_API_KEY: "sk-test",
    OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
    OSVA_M20_7_LIVE_EXECUTE: "1",
  });
  assert.equal(blocked, "OSVA_M20_7_ALLOW_BILLABLE not set");
});

test("overall FAIL propagates from scenario rows", () => {
  const overall = deriveOverallStatusFromScenarios(
    [{ status: "PASS" }, { status: "FAIL" }],
    { liveProviderCalls: true, allScenariosExecuted: true },
  );
  assert.equal(overall, "FAIL");
  assert.equal(
    liveAcceptanceShouldExitNonZero(overall, {
      liveExecuteAttempted: true,
      allScenariosExecuted: true,
    }),
    true,
  );
});

test("preflight incomplete scenarios remain NOT_RUN without fail exit", () => {
  const overall = deriveOverallStatusFromScenarios([], {
    liveProviderCalls: false,
    allScenariosExecuted: false,
  });
  assert.equal(overall, "NOT_RUN");
  assert.equal(
    liveAcceptanceShouldExitNonZero(overall, {
      liveExecuteAttempted: false,
      allScenariosExecuted: false,
    }),
    false,
  );
});

test("intent scoring does not auto-pass compilation-only", () => {
  const score = scoreLiveIntent(
    {
      agents: [{ kind: "NEW", ref: "a", tools: [] }],
      workflow: { nodes: [{ type: "AGENT" }], edges: [] },
    },
    { intentRubric: ["refinement_accuracy"] },
  );
  assert.equal(score.score, 1);
  assert.equal(score.requiresHumanReview, true);
});

test("classify official openai destination", () => {
  assert.equal(
    classifyProviderDestination("https://api.openai.com/v1"),
    "OFFICIAL",
  );
  assert.equal(
    isForbiddenFakeOrigin("http://127.0.0.1:1", ["http://127.0.0.1:1"]),
    true,
  );
});

test("timeout budget dimension", () => {
  const { config } = loadAndValidateBudgetFromEnv(
    {},
    { live: false, smoke: true },
  );
  const usage = createBudgetUsageState();
  usage.elapsedMs = 999999;
  assert.equal(budgetExceeded(usage, config), "MAX_TOTAL_DURATION");
});
