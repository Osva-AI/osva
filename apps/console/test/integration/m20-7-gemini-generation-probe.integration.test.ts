import { execSync } from "node:child_process";
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
  consoleJsonWithHeaders,
  countWorkflowRuns,
} from "./m20-6-builder-helpers.js";
import {
  provisionM20_7LiveModelProfiles,
  resolveM20_7LiveModelConfig,
  verifyWorkspaceModelProfilesAndBuildScoringCatalog,
} from "./m20-7-builder-helpers.js";
import { liveExecuteBlockedReason } from "./m20-7-live-guards.js";
import { startM20_7HumanConsoleStack } from "./m20-7-live-harness.js";
import type { M12_3Stack } from "./m12-3-harness.js";
import {
  estimateUsageCostMicroUsd,
  loadLiveBudgetFromEnv,
  recordLiveProvenanceFromGenerationHttp,
  type M20_7LiveProvenanceState,
} from "./m20-7-live-eval.js";
import {
  assertGeminiProbeArtifactSanitized,
  buildGeminiGenerationProbeArtifact,
  geminiGenerationProbeExecuteExitCode,
  geminiProbeSmokeInstruction,
  M20_7_GEMINI_PROBE_ARTIFACT,
  parseProbeGenerationResponse,
} from "./m20-7-gemini-generation-probe-eval.js";
import { M20_7_DEFAULT_GEMINI_MODEL } from "./m20-7-gemini-model-lifecycle.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ARTIFACT_DIR = path.join(REPO_ROOT, "artifacts", "m20-7");

const LIVE_EXECUTE = process.env.OSVA_M20_7_LIVE_EXECUTE === "1";
const ALLOW_BILLABLE = process.env.OSVA_M20_7_ALLOW_BILLABLE === "1";
const PROBE_EXECUTE = LIVE_EXECUTE && ALLOW_BILLABLE;

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function writeProbeArtifact(payload: Record<string, unknown>): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  assertGeminiProbeArtifactSanitized(payload);
  writeFileSync(
    path.join(ARTIFACT_DIR, M20_7_GEMINI_PROBE_ARTIFACT),
    JSON.stringify(payload, null, 2),
  );
}

describe("M20.7.3 Gemini builder generation probe", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    process.env.OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS ??= "1";
    process.env.OSVA_M20_7_LIVE_PROVIDER ??= "gemini";
    process.env.OSVA_M20_7_GENERATION_MODEL ??= M20_7_DEFAULT_GEMINI_MODEL;
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("dry-run preflight: zero provider invocations", async () => {
    const guardBlocked = liveExecuteBlockedReason(
      {
        OSVA_M20_7_LIVE: "1",
        OSVA_M20_7_ISOLATED: "1",
        GOOGLE_GEMINI_API_KEY: "probe-key",
        OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
        OSVA_M20_7_LIVE_PROVIDER: "gemini",
        OSVA_M20_7_GENERATION_MODEL: M20_7_DEFAULT_GEMINI_MODEL,
      },
      { provider: "gemini" },
    );
    expect(guardBlocked).toBe("OSVA_M20_7_LIVE_EXECUTE not set");

    if (!process.env.GOOGLE_GEMINI_API_KEY?.trim()) {
      process.env.GOOGLE_GEMINI_API_KEY = "sk-m20-7-probe-preflight-only";
    }

    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "live-ready",
    });

    try {
      const config = resolveM20_7LiveModelConfig();
      expect(config.provider).toBe("GOOGLE_GEMINI");
      expect(config.generationModel).toBe(M20_7_DEFAULT_GEMINI_MODEL);

      const models = await provisionM20_7LiveModelProfiles(
        stack,
        stack.workspaceA,
        config,
      );
      await verifyWorkspaceModelProfilesAndBuildScoringCatalog(
        stack,
        stack.workspaceA,
        [models.generationModelProfileVersionId],
      );

      const runsBefore = await countWorkflowRuns(
        stack as unknown as M12_3Stack,
        stack.workspaceA,
      );

      const budget = loadLiveBudgetFromEnv(true);
      const maxInputTokensPerAttempt = Number(
        process.env.OSVA_M20_7_MAX_INPUT_TOKENS ?? 8192,
      );
      const maxOutputTokensPerAttempt = Number(
        process.env.OSVA_M20_7_MAX_OUTPUT_TOKENS ?? 2048,
      );
      const estimatedWorstCaseMicroUsd = estimateUsageCostMicroUsd(
        config.generationModel,
        maxInputTokensPerAttempt,
        maxOutputTokensPerAttempt,
      );
      expect(estimatedWorstCaseMicroUsd).toBe(13824);

      const artifact = buildGeminiGenerationProbeArtifact({
        mode: "dry_run",
        modelId: config.generationModel,
        sourceCommit: gitCommit(),
        maxProviderInvocations: 1,
        maxEstimatedCostUsdMicros: budget.maxEstimatedCostUsdMicros,
        maxInputTokensPerAttempt,
        maxOutputTokensPerAttempt,
        estimatedWorstCaseMicroUsd,
        invocationAttempted: false,
        notes:
          "Stack provisioned; generation skipped until OSVA_M20_7_LIVE_EXECUTE=1 and OSVA_M20_7_ALLOW_BILLABLE=1.",
      });
      writeProbeArtifact(artifact as unknown as Record<string, unknown>);

      const runsAfter = await countWorkflowRuns(
        stack as unknown as M12_3Stack,
        stack.workspaceA,
      );
      expect(runsAfter).toBe(runsBefore);
      expect(artifact.outcome).toBe("PROBE_DRY_RUN");
      expect(artifact.providerAttempts).toBe(0);
    } finally {
      await stack.close();
    }
  }, 300_000);

  it.skipIf(!PROBE_EXECUTE)(
    "execute: single Gemini builder generation (operator billable)",
    async () => {
      const stack = await startM20_7HumanConsoleStack({
        database,
        databaseUrl: postgres.connectionString,
        valkeyUrl: valkey.url,
        profile: "live-ready",
      });

      const config = resolveM20_7LiveModelConfig();
      expect(config.provider).toBe("GOOGLE_GEMINI");

      const budget = loadLiveBudgetFromEnv(true);
      expect(budget.maxProviderInvocations).toBeLessThanOrEqual(1);

      const provenance: M20_7LiveProvenanceState = {
        liveModeRequested: true,
        liveModeAuthorized: true,
        actualProviderCallsObserved: 0,
        providerInvocationAttemptsObserved: 0,
        providerIdentityVerified: false,
      };

      try {
        const models = await provisionM20_7LiveModelProfiles(
          stack,
          stack.workspaceA,
          config,
        );
        const runsBefore = await countWorkflowRuns(
          stack as unknown as M12_3Stack,
          stack.workspaceA,
        );

        await verifyWorkspaceModelProfilesAndBuildScoringCatalog(
          stack,
          stack.workspaceA,
          [models.generationModelProfileVersionId],
        );

        const headers = stack.consoleHeaders(stack.workspaceA);
        const started = performance.now();
        const genRes = await consoleJsonWithHeaders(
          stack,
          "/api/v1/builder/proposals/generate",
          headers,
          {
            method: "POST",
            body: {
              userInstruction: geminiProbeSmokeInstruction(),
              generationModelProfileVersionId:
                models.generationModelProfileVersionId,
            },
          },
        );
        const latencyMs = performance.now() - started;

        const parsed = parseProbeGenerationResponse(genRes.status, genRes.body);
        recordLiveProvenanceFromGenerationHttp(provenance, {
          httpStatus: genRes.status,
          parsed,
          provider: "gemini",
          modelId: config.generationModel,
          connectionVersionId: models.connectionVersionId,
          endpointBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
          forbiddenOrigins: stack.forbiddenProviderOrigins,
        });

        const attempts = parsed?.metadata?.attempts ?? 0;
        expect(attempts).toBeLessThanOrEqual(1);

        const attemptDiagnostics = parsed?.metadata?.attemptDiagnostics ?? [];
        expect(
          attemptDiagnostics.every((a) => a.repairAttempted !== true),
        ).toBe(true);

        const artifact = buildGeminiGenerationProbeArtifact({
          mode: "execute",
          modelId: config.generationModel,
          sourceCommit: gitCommit(),
          httpStatus: genRes.status,
          latencyMs,
          parsed,
          maxProviderInvocations: 1,
          maxEstimatedCostUsdMicros: budget.maxEstimatedCostUsdMicros,
          invocationAttempted: true,
        });
        writeProbeArtifact(artifact as unknown as Record<string, unknown>);

        const runsAfter = await countWorkflowRuns(
          stack as unknown as M12_3Stack,
          stack.workspaceA,
        );
        expect(runsAfter).toBe(runsBefore);

        expect(
          geminiGenerationProbeExecuteExitCode(artifact.outcome),
          `probe outcome ${artifact.outcome}`,
        ).toBe(0);
      } finally {
        await stack.close();
      }
    },
    300_000,
  );
});
