import { randomUUID } from "node:crypto";
import type {
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";
import { Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "../../src/index.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WORKSPACE = "ws-ibpv-concurrency" as WorkspaceId;
const POLICY_ID = "ibp-concurrency" as InferenceBudgetPolicyId;
const NOW = new Date("2026-05-01T12:00:00.000Z");

describe("inference budget policy version concurrency", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let policies: PostgresInferenceBudgetPolicyRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 12,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    policies = new PostgresInferenceBudgetPolicyRepository(database);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({ id: WORKSPACE, name: "Concurrency", createdAt: NOW }),
    );
    await policies.savePolicy({
      id: POLICY_ID,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    await policies.savePolicyVersion({
      id: "ibpv-v1" as InferenceBudgetPolicyVersionId,
      policyId: POLICY_ID,
      workspaceId: WORKSPACE,
      version: 1,
      definition: {
        ...createDefaultInferenceBudgetPolicyDefinition(),
        periodLimitUsdMicros: 1_000_000,
      },
      createdAt: NOW,
    });
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  it("allocates unique monotonic versions under parallel append", async () => {
    const parallel = 8;
    const results = await Promise.all(
      Array.from({ length: parallel }, (_, index) =>
        policies.appendPolicyVersion({
          id: `ibpv-c-${String(index)}` as InferenceBudgetPolicyVersionId,
          policyId: POLICY_ID,
          workspaceId: WORKSPACE,
          definition: {
            ...createDefaultInferenceBudgetPolicyDefinition(),
            periodLimitUsdMicros: 1_000_000 * (index + 2),
          },
          createdAt: new Date(NOW.getTime() + index),
        }),
      ),
    );

    const versionNumbers = results
      .map((row) => row.version)
      .sort((a, b) => a - b);
    expect(versionNumbers).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(versionNumbers).size).toBe(parallel);

    const listed = await policies.listPolicyVersions(WORKSPACE, POLICY_ID);
    expect(listed).toHaveLength(parallel + 1);
    const listedNumbers = listed.map((row) => row.version);
    expect(new Set(listedNumbers).size).toBe(parallel + 1);

    const v1 = await policies.findPolicyVersionById(
      WORKSPACE,
      "ibpv-v1" as InferenceBudgetPolicyVersionId,
    );
    expect(v1?.definition.periodLimitUsdMicros).toBe(1_000_000);
  });

  it("does not reuse version ids when retried with a new primary key", async () => {
    const firstId = randomUUID() as InferenceBudgetPolicyVersionId;
    const first = await policies.appendPolicyVersion({
      id: firstId,
      policyId: POLICY_ID,
      workspaceId: WORKSPACE,
      definition: createDefaultInferenceBudgetPolicyDefinition(),
      createdAt: NOW,
    });
    const secondId = randomUUID() as InferenceBudgetPolicyVersionId;
    const second = await policies.appendPolicyVersion({
      id: secondId,
      policyId: POLICY_ID,
      workspaceId: WORKSPACE,
      definition: {
        ...createDefaultInferenceBudgetPolicyDefinition(),
        periodLimitUsdMicros: 2_000_000,
      },
      createdAt: new Date(NOW.getTime() + 1),
    });
    expect(second.version).toBe(first.version + 1);
    expect(second.id).not.toBe(first.id);
  });
});
