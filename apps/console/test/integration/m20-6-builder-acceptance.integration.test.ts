import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BuilderProposalV1 } from "@osva/domain/builder";
import { computeBuilderProposalDigest } from "@osva/domain/builder";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@osva/db";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const manifest = JSON.parse(
  readFileSync(
    path.join(REPO_ROOT, "scripts/acceptance/m20-6/scenarios/manifest.json"),
    "utf8",
  ),
) as { scenarios: Array<Record<string, unknown>> };

import {
  assertNoSentinelLeak,
  consoleJson,
  resetM12_3Data,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  type M12_3Stack,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  consoleJsonWithHeaders,
  countWorkflowRuns,
  grantOwnerAdminOnWorkspaceB,
  provisionM20_6OpenAiModelProfiles,
  provisionM20_6OpenAiModelProfilesAsOwner,
  provisionViewerInWorkspaceA,
  viewerConsoleHeaders,
} from "./m20-6-builder-helpers.js";
import {
  scoreProposalTopology,
  type M20_6ScenarioResult,
} from "./m20-6-eval.js";

// Re-export scenario ids from fake provider fixtures for digest import path
import { listM20_6ScenarioIds as listScenarioIdsFromFake } from "../../../../adapters/model-openai/test/m20-6-builder-scenario-responses.js";

const LIVE =
  process.env.OSVA_M20_6_LIVE === "1" || process.env.OSVA_M20_6_LIVE === "true";
const SMOKE =
  process.env.OSVA_M20_6_SMOKE === "1" ||
  process.env.OSVA_M20_6_SMOKE === "true";

const ARTIFACT_DIR = path.join(REPO_ROOT, "artifacts", "m20-6");

function scenarioManifest(id: string) {
  return (manifest.scenarios as Array<Record<string, unknown>>).find(
    (s) => s.id === id,
  );
}

function writeEvidence(
  extra: Record<string, unknown>,
  results: readonly M20_6ScenarioResult[],
): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(ARTIFACT_DIR, "acceptance-results.json"),
    JSON.stringify(
      {
        mode: LIVE ? "live" : "deterministic",
        liveProviderCalls: LIVE,
        results,
        ...extra,
      },
      null,
      2,
    ),
  );
}

describe("M20.6 builder product acceptance (real stack)", () => {
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

  async function openStack(): Promise<M12_3Stack> {
    return startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
  }

  async function generateProposal(
    stack: M12_3Stack,
    marker: string,
    generationModelProfileVersionId: string,
  ) {
    const started = performance.now();
    const res = await consoleJson(
      stack,
      stack.workspaceA,
      "/api/v1/builder/proposals/generate",
      {
        method: "POST",
        body: {
          userInstruction: `${marker}\n${marker}`,
          generationModelProfileVersionId,
        },
      },
    );
    return { res, latencyMs: performance.now() - started };
  }

  it("deterministic matrix: generate → validate → publish (no workflow execution)", async () => {
    if (LIVE) {
      writeEvidence({ note: "Skipped deterministic matrix in live mode" }, []);
      return;
    }

    const stack = await openStack();
    const scenarioResults: M20_6ScenarioResult[] = [];
    try {
      const models = await provisionM20_6OpenAiModelProfiles(
        stack,
        stack.workspaceA,
      );
      const runsBefore = await countWorkflowRuns(stack, stack.workspaceA);

      const scenarioIds = SMOKE
        ? (["simple", "conversational-refinement"] as const)
        : listScenarioIdsFromFake();

      for (const id of scenarioIds) {
        const spec = scenarioManifest(id);
        if (spec === undefined) {
          scenarioResults.push({
            id,
            status: "ERROR",
            structuralScore: 0,
            intentScore: 0,
            errorCode: "MISSING_MANIFEST",
          });
          continue;
        }

        const marker = String(spec.marker);
        const structuralSpec = (spec.structural ?? {}) as Record<
          string,
          unknown
        >;
        const requireNodeTypes = (structuralSpec.requireNodeTypes ??
          []) as string[];

        const { res: genRes, latencyMs } = await generateProposal(
          stack,
          marker,
          models.generationModelProfileVersionId,
        );
        assertNoSentinelLeak(genRes.text);
        expect(genRes.status).toBe(200);
        const genBody = genRes.body as {
          ok: boolean;
          proposal?: BuilderProposalV1;
          metadata?: {
            attempts?: number;
            measuredUsage?: {
              usageMeasured?: boolean;
              inputUnits?: number;
              outputUnits?: number;
            };
          };
        };
        expect(genBody.ok).toBe(true);
        const proposal = genBody.proposal!;
        expect(proposal.schemaVersion).toBe("1");

        const topology = scoreProposalTopology(proposal, requireNodeTypes);
        const newAgentCount = proposal.agents.filter(
          (a) => a.kind === "NEW",
        ).length;
        let structuralScore = topology;
        if (
          typeof structuralSpec.minNewAgents === "number" &&
          newAgentCount < structuralSpec.minNewAgents
        ) {
          structuralScore = 0;
        }

        let working = proposal;
        let refinementScore: 0 | 1 | 2 | undefined;

        if (id === "conversational-refinement") {
          const turns = (spec.refinementTurns ?? []) as Array<{
            instruction: string;
            forbidNodeKey?: string;
          }>;
          const turnScores: number[] = [];
          for (const turn of turns) {
            const digest = computeBuilderProposalDigest(working);
            const refineRes = await consoleJson(
              stack,
              stack.workspaceA,
              "/api/v1/builder/proposals/refine",
              {
                method: "POST",
                body: {
                  currentProposal: working,
                  refinementInstruction: turn.instruction,
                  expectedBaseProposalDigest: digest,
                  generationModelProfileVersionId:
                    models.generationModelProfileVersionId,
                },
              },
            );
            if (refineRes.status !== 200) {
              throw new Error(
                `refine failed (${id}): ${JSON.stringify(refineRes.body)}`,
              );
            }
            const refineBody = refineRes.body as {
              ok: boolean;
              candidateProposal: BuilderProposalV1;
            };
            expect(refineBody.ok).toBe(true);
            working = refineBody.candidateProposal;
            if (turn.forbidNodeKey !== undefined) {
              const has = working.workflow.nodes.some(
                (n) => n.key === turn.forbidNodeKey,
              );
              turnScores.push(has ? 0 : 2);
            } else {
              turnScores.push(2);
            }
          }
          refinementScore = turnScores.every((s) => s === 2)
            ? 2
            : turnScores.some((s) => s === 0)
              ? 0
              : 1;
        }

        const validateRes = await consoleJson(
          stack,
          stack.workspaceA,
          "/api/v1/builder/proposals/validate",
          { method: "POST", body: { proposal: working } },
        );
        expect(validateRes.status).toBe(200);

        const prepareRes = await consoleJson(
          stack,
          stack.workspaceA,
          "/api/v1/builder/publications/prepare",
          { method: "POST", body: { proposal: working } },
        );
        expect(prepareRes.status).toBe(200);
        const plan = prepareRes.body as {
          publishable: boolean;
          planDigest: string;
        };
        if (!plan.publishable) {
          throw new Error(
            `scenario ${id} not publishable: ${JSON.stringify(prepareRes.body)}`,
          );
        }

        const idempotencyKey = `m20-6-${id}-${Date.now()}`;
        const publishRes = await consoleJson(
          stack,
          stack.workspaceA,
          "/api/v1/builder/publications",
          {
            method: "POST",
            body: {
              proposal: working,
              expectedPlanDigest: plan.planDigest,
              idempotencyKey,
              confirm: true,
            },
          },
        );
        expect(publishRes.status).toBe(201);
        const replayRes = await consoleJson(
          stack,
          stack.workspaceA,
          "/api/v1/builder/publications",
          {
            method: "POST",
            body: {
              proposal: working,
              expectedPlanDigest: plan.planDigest,
              idempotencyKey,
              confirm: true,
            },
          },
        );
        expect(replayRes.status).toBe(200);
        const replayBody = replayRes.body as { replay: boolean };
        expect(replayBody.replay).toBe(true);

        const intentScore = structuralScore >= 1 ? structuralScore : 0;
        const publicationScore: 0 | 1 | 2 = 2;
        const status =
          structuralScore === 0 || intentScore === 0
            ? "FAIL"
            : refinementScore === 0
              ? "PARTIAL"
              : structuralScore === 2 &&
                  intentScore === 2 &&
                  publicationScore === 2 &&
                  (refinementScore === undefined || refinementScore === 2)
                ? "PASS"
                : "PARTIAL";

        scenarioResults.push({
          id,
          status,
          structuralScore,
          intentScore,
          refinementScore,
          publicationScore,
          latencyMs,
          providerAttempts: genBody.metadata?.attempts,
          usageMeasured:
            genBody.metadata?.measuredUsage?.usageMeasured ?? false,
          inputUnits: genBody.metadata?.measuredUsage?.inputUnits,
          outputUnits: genBody.metadata?.measuredUsage?.outputUnits,
        });
      }

      const runsAfter = await countWorkflowRuns(stack, stack.workspaceA);
      expect(runsAfter).toBe(runsBefore);

      expect(stack.fakeOpenAI.requests.length).toBeGreaterThan(0);

      writeEvidence(
        {
          provider: "fake-openai",
          liveProviderCalls: false,
          openAiRequestCount: stack.fakeOpenAI.requests.length,
          scenarioCount: scenarioResults.length,
          allScenariosExecuted:
            scenarioResults.length === listScenarioIdsFromFake().length ||
            (SMOKE && scenarioResults.length === 2),
        },
        scenarioResults,
      );
    } finally {
      await stack.close();
    }
  }, 600_000);

  it("safety: stale base proposal digest rejected without provider call", async () => {
    const stack = await openStack();
    try {
      const models = await provisionM20_6OpenAiModelProfiles(
        stack,
        stack.workspaceA,
      );
      const { res: genRes } = await generateProposal(
        stack,
        "OSVA_M20_6_SCENARIO=simple",
        models.generationModelProfileVersionId,
      );
      const proposal = (genRes.body as { proposal: BuilderProposalV1 })
        .proposal;
      const requestsBeforeRefine = stack.fakeOpenAI.requests.length;
      const refineRes = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/builder/proposals/refine",
        {
          method: "POST",
          body: {
            currentProposal: proposal,
            refinementInstruction: "Add fact checking.",
            expectedBaseProposalDigest: "stale-digest",
            generationModelProfileVersionId:
              models.generationModelProfileVersionId,
          },
        },
      );
      expect(refineRes.status).toBe(422);
      const body = refineRes.body as { errorCode?: string };
      expect(body.errorCode).toBe("STALE_BASE_PROPOSAL_DIGEST");
      expect(stack.fakeOpenAI.requests.length).toBe(requestsBeforeRefine);
    } finally {
      await stack.close();
    }
  });

  it("safety: workspace B model profile rejected for generation in workspace A (no provider call)", async () => {
    const stack = await openStack();
    try {
      await provisionM20_6OpenAiModelProfiles(stack, stack.workspaceA);
      await grantOwnerAdminOnWorkspaceB(database, stack);
      const modelsB = await provisionM20_6OpenAiModelProfilesAsOwner(
        stack,
        stack.workspaceB,
      );
      const providerCallsBefore = stack.fakeOpenAI.requests.length;
      const res = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/builder/proposals/generate",
        {
          method: "POST",
          body: {
            userInstruction: "OSVA_M20_6_SCENARIO=simple",
            generationModelProfileVersionId:
              modelsB.generationModelProfileVersionId,
          },
        },
      );
      expect(res.status).toBe(422);
      assertNoSentinelLeak(res.text);
      expect(res.text).not.toContain(modelsB.generationModelProfileVersionId);
      const body = res.body as { errorCode?: string; message?: string };
      expect(body.errorCode).toBe("UNAUTHORIZED_GENERATION_MODEL");
      expect(stack.fakeOpenAI.requests.length).toBe(providerCallsBefore);
    } finally {
      await stack.close();
    }
  });

  it("safety: workspace B model profile rejected for refinement in workspace A", async () => {
    const stack = await openStack();
    try {
      const modelsA = await provisionM20_6OpenAiModelProfiles(
        stack,
        stack.workspaceA,
      );
      await grantOwnerAdminOnWorkspaceB(database, stack);
      const modelsB = await provisionM20_6OpenAiModelProfilesAsOwner(
        stack,
        stack.workspaceB,
      );
      const { res: genRes } = await generateProposal(
        stack,
        "OSVA_M20_6_SCENARIO=simple",
        modelsA.generationModelProfileVersionId,
      );
      expect(genRes.status).toBe(200);
      const proposal = (genRes.body as { proposal: BuilderProposalV1 })
        .proposal;
      const digest = computeBuilderProposalDigest(proposal);
      const providerCallsBefore = stack.fakeOpenAI.requests.length;
      const refineRes = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/builder/proposals/refine",
        {
          method: "POST",
          body: {
            currentProposal: proposal,
            refinementInstruction: "Add fact checking.",
            expectedBaseProposalDigest: digest,
            generationModelProfileVersionId:
              modelsB.generationModelProfileVersionId,
          },
        },
      );
      expect(refineRes.status).toBe(422);
      assertNoSentinelLeak(refineRes.text);
      const body = refineRes.body as { errorCode?: string };
      expect(body.errorCode).toBe("UNAUTHORIZED_GENERATION_MODEL");
      expect(stack.fakeOpenAI.requests.length).toBe(providerCallsBefore);
    } finally {
      await stack.close();
    }
  });

  it("safety: VIEWER cannot invoke builder refinement (EXECUTE)", async () => {
    const stack = await openStack();
    try {
      const models = await provisionM20_6OpenAiModelProfiles(
        stack,
        stack.workspaceA,
      );
      await provisionViewerInWorkspaceA(stack);
      const { res: genRes } = await generateProposal(
        stack,
        "OSVA_M20_6_SCENARIO=simple",
        models.generationModelProfileVersionId,
      );
      const proposal = (genRes.body as { proposal: BuilderProposalV1 })
        .proposal;
      const digest = computeBuilderProposalDigest(proposal);
      const viewerHeaders = await viewerConsoleHeaders(stack, stack.workspaceA);
      const refineRes = await consoleJsonWithHeaders(
        stack,
        "/api/v1/builder/proposals/refine",
        viewerHeaders,
        {
          method: "POST",
          body: {
            currentProposal: proposal,
            refinementInstruction: "Add fact checking.",
            expectedBaseProposalDigest: digest,
            generationModelProfileVersionId:
              models.generationModelProfileVersionId,
          },
        },
      );
      expect(refineRes.status).toBe(403);
      assertNoSentinelLeak(refineRes.text);
    } finally {
      await stack.close();
    }
  });
});
