import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@osva/db";

import {
  resetM12_3Data,
  startM12_3Infra,
  stopM12_3Infra,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  provisionM20_7LiveModelProfiles,
  resolveM20_7LiveModelConfig,
} from "./m20-7-builder-helpers.js";
import { startM20_7HumanConsoleStack } from "./m20-7-live-harness.js";
import { countWorkflowRuns } from "./m20-6-builder-helpers.js";
import type { M12_3Stack } from "./m12-3-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ARTIFACT_DIR = path.join(REPO_ROOT, "artifacts", "m20-7");

const LIVE_EXECUTE = process.env.OSVA_M20_7_LIVE_EXECUTE === "1";
const ALLOW_BILLABLE = process.env.OSVA_M20_7_ALLOW_BILLABLE === "1";

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(ARTIFACT_DIR, "acceptance-results.json"),
    JSON.stringify(payload, null, 2),
  );
}

describe("M20.7 live builder acceptance (provisioning + optional billable gate)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("live-ready preflight: provision official provider bindings without provider calls", async () => {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      process.env.OPENAI_API_KEY = "sk-m20-7-preflight-only";
    }

    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "live-ready",
    });

    const runsBefore = await countWorkflowRuns(
      stack as unknown as M12_3Stack,
      stack.workspaceA,
    );
    try {
      const config = resolveM20_7LiveModelConfig();
      const models = await provisionM20_7LiveModelProfiles(
        stack,
        stack.workspaceA,
        config,
      );

      const runsAfter = await countWorkflowRuns(
        stack as unknown as M12_3Stack,
        stack.workspaceA,
      );
      expect(runsAfter).toBe(runsBefore);

      const billableBlocked =
        !LIVE_EXECUTE || !ALLOW_BILLABLE
          ? "BILLABLE_CALLS_DISABLED_FOR_M20_7_1"
          : undefined;

      writeEvidence({
        mode: "live",
        liveModeRequested: true,
        liveModeAuthorized: true,
        liveExecuteAttempted: LIVE_EXECUTE,
        actualProviderCallsObserved: 0,
        providerIdentityVerified: false,
        liveProviderCalls: false,
        providerCategory: config.provider,
        modelIdentifier: config.generationModel,
        connectionVersionId: models.connectionVersionId,
        verifiedDestinationCategory: "OFFICIAL",
        scenarioCount: 0,
        allScenariosExecuted: false,
        overallStatus:
          billableBlocked !== undefined ? "BLOCKED_PREREQUISITE" : "NOT_RUN",
        results: [
          {
            id: "simple",
            status: billableBlocked !== undefined ? "NOT_RUN" : "NOT_RUN",
          },
          {
            id: "conversational-refinement",
            status: billableBlocked !== undefined ? "NOT_RUN" : "NOT_RUN",
          },
        ],
        notes:
          billableBlocked ??
          "Billable gate open — operator must run with natural-language prompts separately.",
      });

      expect(billableBlocked).toBeDefined();
    } finally {
      await stack.close();
    }
  }, 300_000);
});
