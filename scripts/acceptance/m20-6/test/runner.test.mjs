import assert from "node:assert/strict";
import test from "node:test";

import { loadBudgetFromEnv, budgetExceeded } from "../lib/budgets.mjs";
import { liveBlockedReason } from "../lib/live-guards.mjs";
import { redactAcceptanceSecrets } from "../lib/redaction.mjs";
import { scoreStructural, aggregateScenarioVerdict } from "../lib/scoring.mjs";

test("redaction removes bearer tokens", () => {
  const raw = "Authorization: Bearer abc.def.ghi and sk-abcdefghijklmnop";
  const redacted = redactAcceptanceSecrets(raw);
  assert.ok(!redacted.includes("abc.def"));
  assert.ok(!redacted.includes("sk-abcdefghijklmnop"));
});

test("budget exceeded detection", () => {
  const budget = loadBudgetFromEnv({
    OSVA_M20_6_MAX_BUILDER_REQUESTS: "2",
    OSVA_M20_6_MAX_PROVIDER_INVOCATIONS: "4",
    OSVA_M20_6_MAX_TOTAL_DURATION_MS: "1000",
  });
  assert.equal(
    budgetExceeded(
      { builderRequests: 3, providerInvocations: 1, elapsedMs: 10 },
      budget,
    ),
    "MAX_BUILDER_REQUESTS",
  );
});

test("structural scoring detects missing APPROVAL", () => {
  const proposal = {
    agents: [{ kind: "NEW", ref: "bpr_a", tools: [] }],
    workflow: { nodes: [{ type: "AGENT" }], edges: [] },
  };
  const result = scoreStructural(proposal, { requireNodeTypes: ["APPROVAL"] });
  assert.equal(result.score, 1);
});

test("live mode requires explicit OSVA_M20_6_LIVE and provider key", () => {
  assert.equal(liveBlockedReason({}, "openai"), "OSVA_M20_6_LIVE not set");
  assert.equal(
    liveBlockedReason({ OSVA_M20_6_LIVE: "1" }, "openai"),
    "OPENAI_API_KEY missing",
  );
  assert.equal(
    liveBlockedReason(
      { OSVA_M20_6_LIVE: "1", OPENAI_API_KEY: "sk-test" },
      "openai",
    ),
    undefined,
  );
});

test("aggregateScenarioVerdict", () => {
  assert.equal(
    aggregateScenarioVerdict({ structural: 2, intent: 2, publication: 2 }),
    "PASS",
  );
  assert.equal(
    aggregateScenarioVerdict({ structural: 2, intent: 1, publication: 2 }),
    "PARTIAL",
  );
});
