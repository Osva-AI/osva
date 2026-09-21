import type {
  EvaluationCaseId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateEvaluationSuiteKeyError,
  EvaluationCase,
  EvaluationSuite,
  EvaluationSuiteNotFoundError,
  EvaluationSuiteVersion,
  EvaluationSuiteVersionNotFoundError,
  Workspace,
  createEvaluationSuiteApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryEvaluationSuiteRepository } from "../src/memory-evaluation-suite-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, otherWorkspaceId, workspaceId } from "./fixtures.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const scope = fakeControlPlaneScope(workspaceId);

describe("MemoryEvaluationSuiteRepository", () => {
  it("creates, reads, and lists suites", async () => {
    const { application } = await createHarness();
    const created = await application.createEvaluationSuite.execute(scope, {
      workspaceId,
      key: "smoke",
      name: "Smoke Suite",
    });
    const loaded = await application.getEvaluationSuite.execute(
      scope,
      created.id,
    );
    const listed = await application.listEvaluationSuites.execute(scope);

    expect(loaded).toEqual(created);
    expect(listed).toEqual([created]);
  });

  it("rejects an unknown suite", async () => {
    const { application } = await createHarness();
    await expect(
      application.getEvaluationSuite.execute(
        scope,
        "missing" as EvaluationSuiteId,
      ),
    ).rejects.toBeInstanceOf(EvaluationSuiteNotFoundError);
  });

  it("appends immutable suite versions with deterministic case ordering", async () => {
    const { application } = await createHarness();
    const suite = await application.createEvaluationSuite.execute(scope, {
      workspaceId,
      key: "suite",
      name: "Suite",
    });

    const version = await application.appendEvaluationSuiteVersion.execute(
      scope,
      {
        evaluationSuiteId: suite.id,
        cases: [
          {
            key: "zulu",
            input: { prompt: "z" },
            evaluator: { type: "JSON_EXACT_MATCH", expected: { prompt: "z" } },
          },
          {
            key: "alpha",
            input: { prompt: "a" },
            evaluator: { type: "JSON_EXACT_MATCH", expected: { prompt: "a" } },
          },
        ],
      },
    );

    expect(version.version).toBe(1);
    expect(version.cases.map((evaluationCase) => evaluationCase.key)).toEqual([
      "alpha",
      "zulu",
    ]);

    const loaded = await application.getEvaluationSuiteVersion.execute(scope, {
      evaluationSuiteId: suite.id,
      evaluationSuiteVersionId: version.id,
    });
    expect(loaded.cases.map((evaluationCase) => evaluationCase.key)).toEqual([
      "alpha",
      "zulu",
    ]);
  });

  it("enforces nested suite version ownership", async () => {
    const { application } = await createHarness();
    const first = await application.createEvaluationSuite.execute(scope, {
      workspaceId,
      key: "first",
      name: "First",
    });
    const second = await application.createEvaluationSuite.execute(scope, {
      workspaceId,
      key: "second",
      name: "Second",
    });
    const version = await application.appendEvaluationSuiteVersion.execute(
      scope,
      {
        evaluationSuiteId: first.id,
        cases: [
          {
            key: "only",
            input: { prompt: "one" },
            evaluator: {
              type: "JSON_EXACT_MATCH",
              expected: { prompt: "one" },
            },
          },
        ],
      },
    );

    await expect(
      application.getEvaluationSuiteVersion.execute(scope, {
        evaluationSuiteId: second.id,
        evaluationSuiteVersionId: version.id,
      }),
    ).rejects.toBeInstanceOf(EvaluationSuiteVersionNotFoundError);
  });

  it("rejects replacing an immutable suite version", async () => {
    const repository = new MemoryEvaluationSuiteRepository();
    const suite = EvaluationSuite.create({
      id: "evaluation-suite-1" as EvaluationSuiteId,
      workspaceId,
      key: "immutable",
      name: "Immutable",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.saveSuite(suite);

    const versionId = "evaluation-suite-version-1" as EvaluationSuiteVersionId;
    const version = EvaluationSuiteVersion.create({
      id: versionId,
      evaluationSuiteId: suite.id,
      workspaceId,
      version: 1,
      createdAt: NOW,
      cases: [
        EvaluationCase.create({
          id: "evaluation-case-1" as EvaluationCaseId,
          evaluationSuiteVersionId: versionId,
          key: "only",
          input: { prompt: "one" },
          evaluator: { type: "JSON_EXACT_MATCH", expected: { prompt: "one" } },
          createdAt: NOW,
        }),
      ],
    });
    await repository.saveSuiteVersion(version);

    await expect(
      repository.saveSuiteVersion(
        EvaluationSuiteVersion.create({
          id: versionId,
          evaluationSuiteId: suite.id,
          workspaceId,
          version: 1,
          createdAt: NOW,
          cases: [
            EvaluationCase.create({
              id: "evaluation-case-2" as EvaluationCaseId,
              evaluationSuiteVersionId: versionId,
              key: "other",
              input: { prompt: "two" },
              evaluator: {
                type: "JSON_EXACT_MATCH",
                expected: { prompt: "one" },
              },
              createdAt: NOW,
            }),
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("rejects duplicate suite keys within the same workspace", async () => {
    const { application } = await createHarness();
    await application.createEvaluationSuite.execute(scope, {
      workspaceId,
      key: "shared",
      name: "Shared",
    });

    await expect(
      application.createEvaluationSuite.execute(scope, {
        workspaceId,
        key: "shared",
        name: "Other",
      }),
    ).rejects.toBeInstanceOf(DuplicateEvaluationSuiteKeyError);
  });

  it("allows the same suite key in a different workspace", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await workspaces.save(
      Workspace.create({
        id: otherWorkspaceId,
        name: "Other Workspace",
        createdAt: NOW,
      }),
    );

    const repository = new MemoryEvaluationSuiteRepository();
    await repository.saveSuite(
      EvaluationSuite.create({
        id: "evaluation-suite-1" as EvaluationSuiteId,
        workspaceId,
        key: "shared-key",
        name: "Primary",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await repository.saveSuite(
      EvaluationSuite.create({
        id: "evaluation-suite-2" as EvaluationSuiteId,
        workspaceId: otherWorkspaceId,
        key: "shared-key",
        name: "Other Workspace Suite",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    expect(await repository.listSuitesByWorkspace(workspaceId)).toHaveLength(1);
    expect(
      await repository.listSuitesByWorkspace(otherWorkspaceId),
    ).toHaveLength(1);
  });
});

async function createHarness() {
  const workspaces = new MemoryWorkspaceRepository();
  const repository = new MemoryEvaluationSuiteRepository();
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  await workspaces.save(
    Workspace.create({
      id: otherWorkspaceId,
      name: "Other Workspace",
      createdAt: NOW,
    }),
  );

  let counter = 0;
  return {
    repository,
    application: createEvaluationSuiteApplication({
      evaluationSuites: repository,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `evaluation-id-${String(counter)}`;
        },
      },
    }),
  };
}
