import type {
  EvaluationCaseId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  JsonValue,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { AgentVersionId, EvaluationRunId } from "@osva-ai/contracts";
import {
  DomainInvariantError,
  EvaluationCase,
  EvaluationGateAssessmentConflictError,
  EvaluationRun,
  EvaluationRunGateAssessment,
  EvaluationSuite,
  EvaluationSuiteVersion,
  Workspace,
  assessEvaluationQualityGate,
  isSameEvaluationRunGateAssessment,
} from "@osva/domain";
import { EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW, createIds } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL evaluation suite repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let suites: PostgresEvaluationSuiteRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    suites = new PostgresEvaluationSuiteRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("persists suites and immutable versions with cases", async () => {
    const ids = createIds("evaluation-suite");
    await seedWorkspace(ids.workspaceId);

    const suite = EvaluationSuite.create({
      id: "evaluation-suite-1" as EvaluationSuiteId,
      workspaceId: ids.workspaceId,
      key: "smoke",
      name: "Smoke Suite",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suite);

    const version = await seedVersion({
      suite,
      versionNumber: 1,
      versionId: "evaluation-suite-version-1" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-b" as EvaluationCaseId,
          key: "beta",
          input: { prompt: "b" },
          expected: { echoed: { prompt: "b" } },
        },
        {
          id: "evaluation-case-a" as EvaluationCaseId,
          key: "alpha",
          input: { prompt: "a" },
          expected: { echoed: { prompt: "a" } },
        },
      ],
    });

    const loadedSuite = await suites.findSuiteById(suite.id);
    const loadedVersion = await suites.findSuiteVersionById(version.id);
    const listedVersions = await suites.listSuiteVersionsBySuite(suite.id);

    expect(loadedSuite).toEqual(suite);
    expect(
      loadedVersion?.cases.map((evaluationCase) => evaluationCase.key),
    ).toEqual(["alpha", "beta"]);
    expect(listedVersions).toHaveLength(1);
    expect(listedVersions[0]?.version).toBe(1);
  });

  it("rejects replacing an immutable EvaluationSuiteVersion", async () => {
    const ids = createIds("evaluation-immutable");
    await seedWorkspace(ids.workspaceId);

    const suite = EvaluationSuite.create({
      id: "evaluation-suite-immutable" as EvaluationSuiteId,
      workspaceId: ids.workspaceId,
      key: "immutable",
      name: "Immutable",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suite);

    const version = await seedVersion({
      suite,
      versionNumber: 1,
      versionId:
        "evaluation-suite-version-immutable" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-1" as EvaluationCaseId,
          key: "only",
          input: { prompt: "one" },
          expected: { echoed: { prompt: "one" } },
        },
      ],
    });

    await expect(
      suites.saveSuiteVersion(
        EvaluationSuiteVersion.create({
          id: version.id,
          evaluationSuiteId: suite.id,
          workspaceId: suite.workspaceId,
          version: version.version + 1,
          createdAt: NOW,
          cases: [
            EvaluationCase.create({
              id: "evaluation-case-2" as EvaluationCaseId,
              evaluationSuiteVersionId: version.id,
              key: "other",
              input: { prompt: "two" },
              expected: { echoed: { prompt: "two" } },
              evaluator: {
                type: "JSON_EXACT_MATCH",
                expected: { echoed: { prompt: "two" } },
              },
              createdAt: NOW,
            }),
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("isolates suites and versions by workspace", async () => {
    const first = createIds("evaluation-ws-a");
    const second = createIds("evaluation-ws-b");
    await seedWorkspace(first.workspaceId, "Workspace A");
    await seedWorkspace(second.workspaceId, "Workspace B");

    const suiteA = EvaluationSuite.create({
      id: "evaluation-suite-a" as EvaluationSuiteId,
      workspaceId: first.workspaceId,
      key: "shared-key",
      name: "Suite A",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const suiteB = EvaluationSuite.create({
      id: "evaluation-suite-b" as EvaluationSuiteId,
      workspaceId: second.workspaceId,
      key: "shared-key",
      name: "Suite B",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suiteA);
    await suites.saveSuite(suiteB);

    const versionA = await seedVersion({
      suite: suiteA,
      versionNumber: 1,
      versionId: "evaluation-suite-version-a" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-a" as EvaluationCaseId,
          key: "a",
          input: { prompt: "a" },
          expected: { echoed: { prompt: "a" } },
        },
      ],
    });
    const versionB = await seedVersion({
      suite: suiteB,
      versionNumber: 1,
      versionId: "evaluation-suite-version-b" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-b" as EvaluationCaseId,
          key: "b",
          input: { prompt: "b" },
          expected: { echoed: { prompt: "b" } },
        },
      ],
    });

    expect(await suites.listSuitesByWorkspace(first.workspaceId)).toEqual([
      suiteA,
    ]);
    expect(await suites.listSuitesByWorkspace(second.workspaceId)).toEqual([
      suiteB,
    ]);
    expect(await suites.listSuiteVersionsBySuite(suiteA.id)).toEqual([
      versionA,
    ]);
    expect(await suites.listSuiteVersionsBySuite(suiteB.id)).toEqual([
      versionB,
    ]);
  });

  it("lists evaluation runs with workspace scope, filters, and cursor pagination", async () => {
    const ids = createIds("evaluation-run-list");
    await seedWorkspace(ids.workspaceId);

    const suite = EvaluationSuite.create({
      id: "evaluation-suite-list" as EvaluationSuiteId,
      workspaceId: ids.workspaceId,
      key: "list",
      name: "List",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suite);

    const version = await seedVersion({
      suite,
      versionNumber: 1,
      versionId: "evaluation-suite-version-list" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-list" as EvaluationCaseId,
          key: "one",
          input: { prompt: "x" },
        },
      ],
    });

    const agentVersionId = "agent-version-list" as AgentVersionId;
    const runs = [
      EvaluationRun.create({
        id: "evaluation-run-1" as EvaluationRunId,
        workspaceId: ids.workspaceId,
        evaluationSuiteVersionId: version.id,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
      EvaluationRun.create({
        id: "evaluation-run-2" as EvaluationRunId,
        workspaceId: ids.workspaceId,
        evaluationSuiteVersionId: version.id,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      EvaluationRun.create({
        id: "evaluation-run-3" as EvaluationRunId,
        workspaceId: ids.workspaceId,
        evaluationSuiteVersionId: version.id,
        targetType: "AGENT_VERSION",
        targetVersionId: "other-agent-version" as AgentVersionId,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ];

    for (const evaluationRun of runs) {
      await suites.saveEvaluationRun(evaluationRun);
      const running = evaluationRun.transitionTo("RUNNING", {
        updatedAt: NOW,
        startedAt: NOW,
      });
      await suites.transitionEvaluationRun(evaluationRun.status, running);
    }

    const filtered = await suites.listEvaluationRuns({
      workspaceId: ids.workspaceId,
      limit: 10,
      agentVersionId,
      evaluationSuiteId: suite.id,
      status: "RUNNING",
    });
    expect(filtered.evaluationRuns.map((item) => item.id)).toEqual([
      "evaluation-run-1",
      "evaluation-run-2",
    ]);

    const pageOne = await suites.listEvaluationRuns({
      workspaceId: ids.workspaceId,
      limit: 1,
    });
    expect(pageOne.evaluationRuns.map((item) => item.id)).toEqual([
      "evaluation-run-1",
    ]);
    expect(pageOne.nextCursor).toBeDefined();

    const pageTwo = await suites.listEvaluationRuns({
      workspaceId: ids.workspaceId,
      limit: 1,
      cursor: pageOne.nextCursor,
    });
    expect(pageTwo.evaluationRuns.map((item) => item.id)).toEqual([
      "evaluation-run-2",
    ]);
  });

  it("persists evaluation run gate policy snapshots and terminal assessments", async () => {
    const ids = createIds("evaluation-gate");
    await seedWorkspace(ids.workspaceId);

    const suite = EvaluationSuite.create({
      id: "evaluation-suite-gate" as EvaluationSuiteId,
      workspaceId: ids.workspaceId,
      key: "gate",
      name: "Gate",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suite);
    const version = await seedVersion({
      suite,
      versionNumber: 1,
      versionId: "evaluation-suite-version-gate" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-gate" as EvaluationCaseId,
          key: "one",
          input: { prompt: "x" },
        },
      ],
    });

    const gatePolicy = {
      schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
      rules: [
        {
          metric: "PASS_RATE" as const,
          operator: "MIN" as const,
          threshold: 1,
        },
      ],
    };

    const evaluationRun = EvaluationRun.create({
      id: "evaluation-run-gate" as EvaluationRunId,
      workspaceId: ids.workspaceId,
      evaluationSuiteVersionId: version.id,
      targetType: "AGENT_VERSION",
      targetVersionId: "agent-version-gate" as AgentVersionId,
      qualityGatePolicy: gatePolicy,
      createdAt: NOW,
    });

    await suites.saveEvaluationRun(evaluationRun);
    const loaded = await suites.findEvaluationRunById(evaluationRun.id);
    expect(loaded?.qualityGatePolicy).toEqual(gatePolicy);

    const assessmentBody = assessEvaluationQualityGate({
      policy: gatePolicy,
      evaluationRunStatus: "COMPLETED",
      summary: {
        totalCases: 1,
        pendingCases: 0,
        runningCases: 0,
        completedCases: 1,
        passedCases: 1,
        failedCases: 0,
        errorCases: 0,
        passRate: 1,
        completionCoverage: 1,
        validScoredCaseCount: 1,
        qualityScore: 1,
        durationMs: 10,
        inputTokens: 0,
        outputTokens: 0,
        pricedCostUsdMicros: 0,
        unpricedModelCalls: 0,
        usageMeasured: true,
      },
      assessedAt: NOW,
      allowFinalPass: true,
    });

    const record = EvaluationRunGateAssessment.create({
      evaluationRunId: evaluationRun.id,
      workspaceId: ids.workspaceId,
      policySnapshot: gatePolicy,
      assessment: assessmentBody,
    });

    await suites.saveGateAssessment(record);
    await suites.saveGateAssessment(record);

    const stored = await suites.findGateAssessmentByWorkspaceAndEvaluationRunId(
      ids.workspaceId,
      evaluationRun.id,
    );
    expect(stored).not.toBeNull();
    expect(isSameEvaluationRunGateAssessment(record, stored!)).toBe(true);

    const otherWorkspace =
      await suites.findGateAssessmentByWorkspaceAndEvaluationRunId(
        "workspace-other" as WorkspaceId,
        evaluationRun.id,
      );
    expect(otherWorkspace).toBeNull();

    const conflicting = EvaluationRunGateAssessment.create({
      evaluationRunId: evaluationRun.id,
      workspaceId: ids.workspaceId,
      policySnapshot: gatePolicy,
      assessment: {
        ...assessmentBody,
        overallVerdict: "FAIL",
      },
    });
    await expect(suites.saveGateAssessment(conflicting)).rejects.toBeInstanceOf(
      EvaluationGateAssessmentConflictError,
    );
  });

  it("returns cases in deterministic key order regardless of insertion order", async () => {
    const ids = createIds("evaluation-order");
    await seedWorkspace(ids.workspaceId);

    const suite = EvaluationSuite.create({
      id: "evaluation-suite-order" as EvaluationSuiteId,
      workspaceId: ids.workspaceId,
      key: "order",
      name: "Order",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await suites.saveSuite(suite);

    const version = await seedVersion({
      suite,
      versionNumber: 1,
      versionId: "evaluation-suite-version-order" as EvaluationSuiteVersionId,
      caseDefinitions: [
        {
          id: "evaluation-case-z" as EvaluationCaseId,
          key: "zulu",
          input: { prompt: "z" },
        },
        {
          id: "evaluation-case-m" as EvaluationCaseId,
          key: "mike",
          input: { prompt: "m" },
        },
        {
          id: "evaluation-case-a" as EvaluationCaseId,
          key: "alpha",
          input: { prompt: "a" },
        },
      ],
    });

    const loaded = await suites.findSuiteVersionById(version.id);
    expect(loaded?.cases.map((evaluationCase) => evaluationCase.key)).toEqual([
      "alpha",
      "mike",
      "zulu",
    ]);
  });

  async function seedWorkspace(id: WorkspaceId, name = "Workspace") {
    await workspaces.save(
      Workspace.create({
        id,
        name,
        createdAt: NOW,
      }),
    );
  }

  async function seedVersion(options: {
    readonly suite: EvaluationSuite;
    readonly versionNumber: number;
    readonly versionId: EvaluationSuiteVersionId;
    readonly caseDefinitions: readonly {
      readonly id: EvaluationCaseId;
      readonly key: string;
      readonly input: JsonValue;
      readonly expected?: JsonValue;
    }[];
  }): Promise<EvaluationSuiteVersion> {
    const cases = options.caseDefinitions.map((definition) =>
      EvaluationCase.create({
        id: definition.id,
        evaluationSuiteVersionId: options.versionId,
        key: definition.key,
        input: definition.input,
        expected: definition.expected,
        evaluator: {
          type: "JSON_EXACT_MATCH",
          expected: definition.expected ?? definition.input,
        },
        createdAt: NOW,
      }),
    );
    const version = EvaluationSuiteVersion.create({
      id: options.versionId,
      evaluationSuiteId: options.suite.id,
      workspaceId: options.suite.workspaceId,
      version: options.versionNumber,
      cases,
      createdAt: NOW,
    });
    await suites.saveSuiteVersion(version);
    return version;
  }
});
