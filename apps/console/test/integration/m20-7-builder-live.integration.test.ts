import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type { BuilderProposalV1 } from "@osva/domain/builder";
import { computeBuilderProposalDigest } from "@osva/domain/builder";
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
import {
  liveExecuteBlockedReason,
  m20_7BillableLiveExecuteEnv,
  m20_7NonBillableLiveExecuteEnv,
} from "./m20-7-live-guards.js";
import { startM20_7HumanConsoleStack } from "./m20-7-live-harness.js";
import type { M12_3Stack } from "./m12-3-harness.js";
import {
  budgetGateExceeded,
  deriveM20_7OverallStatus,
  deriveScenarioStatus,
  estimateUsageCostMicroUsd,
  loadLiveBudgetFromEnv,
  officialEndpointForProvider,
  formatProviderDiagnosticForVitest,
  parseLiveBuilderGenerationBody,
  providerEvidenceForScenario,
  recordLiveProvenanceFromGenerationHttp,
  recordLiveProvenanceFromMetadata,
  scoreLiveGenerationIntent,
  scoreLiveGenerationStructural,
  scoreLiveRefinement,
  type LiveSmokeManifestOperation,
  type M20_7LiveProvenanceState,
} from "./m20-7-live-eval.js";
import type { M20_6ScenarioResult } from "./m20-6-eval.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ARTIFACT_DIR = path.join(REPO_ROOT, "artifacts", "m20-7");

const LIVE_EXECUTE = process.env.OSVA_M20_7_LIVE_EXECUTE === "1";
const ALLOW_BILLABLE = process.env.OSVA_M20_7_ALLOW_BILLABLE === "1";
const SMOKE =
  process.env.OSVA_M20_7_SMOKE === "1" ||
  process.env.OSVA_M20_7_SMOKE === "true";
const BILLABLE_SMOKE = LIVE_EXECUTE && ALLOW_BILLABLE && SMOKE;

const liveSmokeManifest = JSON.parse(
  readFileSync(
    path.join(
      REPO_ROOT,
      "scripts/acceptance/m20-7/scenarios/live-smoke-manifest.json",
    ),
    "utf8",
  ),
) as { operations: LiveSmokeManifestOperation[] };

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(ARTIFACT_DIR, "acceptance-results.json"),
    JSON.stringify(payload, null, 2),
  );
}

describe("M20.7 live builder acceptance", () => {
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

      const nonBillableEnv = m20_7NonBillableLiveExecuteEnv();
      const billableBlocked = liveExecuteBlockedReason(nonBillableEnv);
      expect(billableBlocked).toBeDefined();
      expect(billableBlocked).toBe("OSVA_M20_7_LIVE_EXECUTE not set");

      const authorizedEnv = m20_7BillableLiveExecuteEnv();
      expect(liveExecuteBlockedReason(authorizedEnv)).toBeUndefined();

      writeEvidence({
        mode: "live",
        runId: randomUUID(),
        harnessVersion: "m20-7.2",
        liveModeRequested: true,
        liveModeAuthorized: true,
        liveExecuteAttempted: false,
        actualProviderCallsObserved: 0,
        providerInvocationAttemptsObserved: 0,
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
        results: liveSmokeManifest.operations.map((op) => ({
          id: op.id,
          status: "NOT_RUN" as const,
        })),
        notes:
          billableBlocked ??
          "Provisioning OK — enable billable smoke for NL scenarios.",
        billableGuardCheckEnv: "explicit-non-billable",
      });

      expect(stack.fakeOpenAI).toBeUndefined();
    } finally {
      await stack.close();
    }
  }, 300_000);

  it.skipIf(!BILLABLE_SMOKE)(
    "live smoke: natural-language workflow generation + conversational refinement",
    async () => {
      const stack = await startM20_7HumanConsoleStack({
        database,
        databaseUrl: postgres.connectionString,
        valkeyUrl: valkey.url,
        profile: "live-ready",
      });

      const budget = loadLiveBudgetFromEnv(true);
      const provenance: M20_7LiveProvenanceState = {
        liveModeRequested: true,
        liveModeAuthorized: true,
        actualProviderCallsObserved: 0,
        providerInvocationAttemptsObserved: 0,
        providerIdentityVerified: false,
      };

      const scenarioResults: M20_6ScenarioResult[] = [];
      let sessionProposal: BuilderProposalV1 | undefined;
      const config = resolveM20_7LiveModelConfig();
      const endpoint = officialEndpointForProvider(config.provider);

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

        const headers = stack.consoleHeaders(stack.workspaceA);
        const catalog =
          await verifyWorkspaceModelProfilesAndBuildScoringCatalog(
            stack,
            stack.workspaceA,
            [
              models.generationModelProfileVersionId,
              models.executionModelProfileVersionId,
              models.alternateModelProfileVersionId,
            ],
          );
        expect(catalog.workspaceId).toBe(stack.workspaceA);
        expect(catalog.modelProfileVersions.length).toBeGreaterThan(0);

        for (const op of liveSmokeManifest.operations) {
          const builderGate = budgetGateExceeded(budget, "builder");
          if (builderGate !== undefined) {
            scenarioResults.push({
              id: op.id,
              status: "ERROR",
              structuralScore: 0,
              intentScore: 0,
              errorCode: builderGate,
            });
            continue;
          }

          if (op.kind === "generate") {
            const instruction = op.userInstruction ?? "";
            for (const marker of op.forbiddenInstructionMarkers ?? []) {
              expect(instruction.includes(marker)).toBe(false);
            }

            budget.builderRequestsUsed += 1;
            const started = performance.now();
            const genRes = await consoleJsonWithHeaders(
              stack,
              "/api/v1/builder/proposals/generate",
              headers,
              {
                method: "POST",
                body: {
                  userInstruction: instruction,
                  generationModelProfileVersionId:
                    models.generationModelProfileVersionId,
                },
              },
            );
            const latencyMs = performance.now() - started;

            const genBody = parseLiveBuilderGenerationBody(
              genRes.status,
              genRes.body,
            );
            const genFailure = recordLiveProvenanceFromGenerationHttp(
              provenance,
              {
                httpStatus: genRes.status,
                parsed: genBody,
                provider: config.provider,
                modelId: config.generationModel,
                connectionVersionId: models.connectionVersionId,
                endpointBaseUrl: endpoint,
                forbiddenOrigins: stack.forbiddenProviderOrigins,
              },
            );

            const attempts = genBody?.metadata?.attempts ?? 0;
            budget.providerInvocationsUsed += attempts;

            if (
              genRes.status !== 200 ||
              genBody?.ok !== true ||
              genBody.proposal === undefined
            ) {
              scenarioResults.push({
                id: op.id,
                status: "ERROR",
                structuralScore: 0,
                intentScore: 0,
                latencyMs,
                providerAttempts: attempts,
                httpStatus: genRes.status,
                errorCode:
                  genFailure?.builderErrorCode ?? `HTTP_${genRes.status}`,
                builderErrorCode: genFailure?.builderErrorCode,
                builderMessage: genFailure?.builderMessage,
                builderDetailMessages: genFailure?.detailMessages,
                ...providerEvidenceForScenario({
                  failure: genFailure,
                  parsed: genBody,
                }),
              });
              continue;
            }

            sessionProposal = genBody.proposal;

            const usage = genBody.metadata?.measuredUsage;
            if (
              usage?.usageMeasured === true &&
              usage.inputUnits !== undefined &&
              usage.outputUnits !== undefined
            ) {
              const cost = estimateUsageCostMicroUsd(
                config.generationModel,
                usage.inputUnits,
                usage.outputUnits,
              );
              if (cost !== undefined) {
                budget.estimatedCostUsdMicros += cost;
              }
            } else if (budget.maxEstimatedCostUsdMicros !== undefined) {
              scenarioResults.push({
                id: op.id,
                status: "ERROR",
                structuralScore: 0,
                intentScore: 0,
                errorCode: "UNKNOWN_USAGE_UNDER_COST_CAP",
              });
              continue;
            }

            const structural = scoreLiveGenerationStructural(
              genBody.proposal,
              catalog,
              op.structural,
            );
            const intent = scoreLiveGenerationIntent(
              genBody.proposal,
              op.intentRubric,
            );

            scenarioResults.push({
              id: op.id,
              status: deriveScenarioStatus(structural.score, intent.score),
              structuralScore: structural.score,
              intentScore: intent.score,
              latencyMs,
              providerAttempts: attempts,
              usageMeasured: usage?.usageMeasured ?? false,
              inputUnits: usage?.inputUnits,
              outputUnits: usage?.outputUnits,
            });
            continue;
          }

          if (op.kind === "refine") {
            if (sessionProposal === undefined) {
              scenarioResults.push({
                id: op.id,
                status: "ERROR",
                structuralScore: 0,
                intentScore: 0,
                errorCode: "MISSING_BASE_PROPOSAL",
              });
              continue;
            }

            budget.builderRequestsUsed += 1;
            const baseDigest = computeBuilderProposalDigest(sessionProposal);
            const started = performance.now();
            const refineRes = await consoleJsonWithHeaders(
              stack,
              "/api/v1/builder/proposals/refine",
              headers,
              {
                method: "POST",
                body: {
                  currentProposal: sessionProposal,
                  refinementInstruction: op.refinementInstruction ?? "",
                  expectedBaseProposalDigest: baseDigest,
                  generationModelProfileVersionId:
                    models.generationModelProfileVersionId,
                },
              },
            );
            const latencyMs = performance.now() - started;

            if (refineRes.status !== 200) {
              const parsedRefineFailure = parseLiveBuilderGenerationBody(
                refineRes.status,
                refineRes.body,
              );
              const refineHttpFailure = recordLiveProvenanceFromGenerationHttp(
                provenance,
                {
                  httpStatus: refineRes.status,
                  parsed: parsedRefineFailure,
                  provider: config.provider,
                  modelId: config.generationModel,
                  connectionVersionId: models.connectionVersionId,
                  endpointBaseUrl: endpoint,
                  forbiddenOrigins: stack.forbiddenProviderOrigins,
                },
              );
              const refineFailAttempts =
                parsedRefineFailure?.metadata?.attempts ?? 0;
              budget.providerInvocationsUsed += refineFailAttempts;
              scenarioResults.push({
                id: op.id,
                status: "ERROR",
                structuralScore: 0,
                intentScore: 0,
                latencyMs,
                providerAttempts: refineFailAttempts,
                httpStatus: refineRes.status,
                errorCode:
                  refineHttpFailure?.builderErrorCode ??
                  `HTTP_${refineRes.status}`,
                builderErrorCode: refineHttpFailure?.builderErrorCode,
                builderMessage: refineHttpFailure?.builderMessage,
                ...providerEvidenceForScenario({
                  failure: refineHttpFailure,
                  parsed: parsedRefineFailure,
                }),
              });
              continue;
            }

            const refineBody = refineRes.body as {
              ok: boolean;
              candidateProposal?: BuilderProposalV1;
              changes?: import("@osva/domain/builder").BuilderProposalChangesetV1;
              metadata?: {
                attempts?: number;
                measuredUsage?: {
                  usageMeasured?: boolean;
                  inputUnits?: number;
                  outputUnits?: number;
                };
              };
              errorCode?: string;
            };

            const attempts = refineBody.metadata?.attempts ?? 0;
            budget.providerInvocationsUsed += attempts;

            recordLiveProvenanceFromMetadata(provenance, {
              provider: config.provider,
              modelId: config.generationModel,
              connectionVersionId: models.connectionVersionId,
              endpointBaseUrl: endpoint,
              attempts,
              invocationSucceeded: refineBody.ok === true,
              forbiddenOrigins: stack.forbiddenProviderOrigins,
            });

            if (!refineBody.ok || refineBody.candidateProposal === undefined) {
              scenarioResults.push({
                id: op.id,
                status: "ERROR",
                structuralScore: 0,
                intentScore: 0,
                refinementScore: 0,
                latencyMs,
                providerAttempts: attempts,
                errorCode: refineBody.errorCode ?? "INVALID_BUILDER_PROPOSAL",
              });
              continue;
            }

            const usage = refineBody.metadata?.measuredUsage;
            if (
              usage?.usageMeasured === true &&
              usage.inputUnits !== undefined &&
              usage.outputUnits !== undefined
            ) {
              const cost = estimateUsageCostMicroUsd(
                config.generationModel,
                usage.inputUnits,
                usage.outputUnits,
              );
              if (cost !== undefined) {
                budget.estimatedCostUsdMicros += cost;
              }
            }

            const structural = scoreLiveGenerationStructural(
              refineBody.candidateProposal,
              catalog,
              op.structural,
            );
            const intent = scoreLiveGenerationIntent(
              refineBody.candidateProposal,
              op.intentRubric,
            );
            const refinement = scoreLiveRefinement(
              sessionProposal,
              refineBody.candidateProposal,
              refineBody.changes,
              op.refinementExpectations,
              op.intentRubric,
            );

            scenarioResults.push({
              id: op.id,
              status: deriveScenarioStatus(
                structural.score,
                intent.score,
                refinement.score,
              ),
              structuralScore: structural.score,
              intentScore: intent.score,
              refinementScore: refinement.score,
              latencyMs,
              providerAttempts: attempts,
              usageMeasured: usage?.usageMeasured ?? false,
              inputUnits: usage?.inputUnits,
              outputUnits: usage?.outputUnits,
            });

            sessionProposal = refineBody.candidateProposal;
          }
        }

        const runsAfter = await countWorkflowRuns(
          stack as unknown as M12_3Stack,
          stack.workspaceA,
        );
        expect(runsAfter).toBe(runsBefore);

        const liveProviderCalls =
          provenance.providerIdentityVerified === true &&
          provenance.actualProviderCallsObserved > 0;

        const allExecuted =
          scenarioResults.length === liveSmokeManifest.operations.length &&
          scenarioResults.every((r) => r.status !== "NOT_RUN");

        const overallStatus = deriveM20_7OverallStatus(scenarioResults, {
          liveProviderCalls,
          allScenariosExecuted: allExecuted,
        });

        const publishSmokeEvidence = (): void => {
          const failure = provenance.lastBuilderGenerationFailure;
          writeEvidence({
            mode: "live",
            runId: randomUUID(),
            harnessVersion: "m20-7.2",
            ...provenance,
            liveModeRequested: true,
            liveModeAuthorized: true,
            liveExecuteAttempted: true,
            liveProviderCalls,
            generationModel: config.generationModel,
            executionModel: config.executionModel,
            budgets: {
              ...budget,
              costCapMicroUsd: budget.maxEstimatedCostUsdMicros,
            },
            scenarioCount: scenarioResults.length,
            allScenariosExecuted: allExecuted,
            overallStatus,
            results: scenarioResults,
            generationFailure: failure,
            humanReviewNotes: scenarioResults.some(
              (r) => r.status === "PARTIAL",
            )
              ? "One or more rubric dimensions scored PARTIAL — review artifacts."
              : undefined,
            notes:
              failure !== undefined
                ? `Builder generation failed: ${failure.builderErrorCode} (HTTP ${failure.httpStatus}).`
                : "Live smoke completed (billable).",
          });
        };

        publishSmokeEvidence();

        const failedGeneration = scenarioResults.find(
          (row) => row.id === "workflow-generation" && row.status === "ERROR",
        );
        if (failedGeneration !== undefined) {
          const providerHint = formatProviderDiagnosticForVitest(
            provenance.lastBuilderGenerationFailure,
            undefined,
          );
          expect.fail(
            `workflow-generation ERROR: ${failedGeneration.builderErrorCode ?? failedGeneration.errorCode} HTTP ${failedGeneration.httpStatus ?? "?"} providerAttempts=${failedGeneration.providerAttempts ?? 0} message=${failedGeneration.builderMessage ?? "n/a"} ${providerHint}`,
          );
        }

        expect(provenance.providerInvocationAttemptsObserved).toBeGreaterThan(
          0,
        );
        expect(provenance.actualProviderCallsObserved).toBeGreaterThan(0);
        expect(liveProviderCalls).toBe(true);
        expect(scenarioResults.every((r) => r.status !== "ERROR")).toBe(true);
        const notPass = scenarioResults.filter((r) => r.status !== "PASS");
        expect(
          notPass.map((r) => `${r.id}:${r.status}`).join(", "),
          "all live smoke scenarios must PASS",
        ).toBe("");
      } finally {
        try {
          const liveProviderCalls =
            provenance.providerIdentityVerified === true &&
            provenance.actualProviderCallsObserved > 0;
          const allExecuted =
            scenarioResults.length === liveSmokeManifest.operations.length &&
            scenarioResults.every((r) => r.status !== "NOT_RUN");
          const overallStatus = deriveM20_7OverallStatus(scenarioResults, {
            liveProviderCalls,
            allScenariosExecuted: allExecuted,
          });
          const failure = provenance.lastBuilderGenerationFailure;
          writeEvidence({
            mode: "live",
            runId: randomUUID(),
            harnessVersion: "m20-7.2",
            ...provenance,
            liveModeRequested: true,
            liveModeAuthorized: true,
            liveExecuteAttempted: true,
            liveProviderCalls,
            generationModel: config.generationModel,
            executionModel: config.executionModel,
            budgets: {
              ...budget,
              costCapMicroUsd: budget.maxEstimatedCostUsdMicros,
            },
            scenarioCount: scenarioResults.length,
            allScenariosExecuted: allExecuted,
            overallStatus,
            results: scenarioResults,
            generationFailure: failure,
            notes:
              failure !== undefined
                ? `Builder generation failed: ${failure.builderErrorCode} (HTTP ${failure.httpStatus}).`
                : "Live smoke evidence flushed from finally.",
          });
        } catch {
          // Best-effort artifact write when the try block aborted early.
        }
        await stack.close();
      }
    },
    600_000,
  );
});
