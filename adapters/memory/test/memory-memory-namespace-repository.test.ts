import type { MemoryNamespaceId } from "@osva/contracts";
import {
  DuplicateMemoryNamespaceKeyError,
  MEMORY_RECORD_INITIAL_REVISION,
  MemoryNamespace,
  MemoryNamespaceNotFoundError,
  MemoryRecordConflictError,
  MemoryRecordNotFoundError,
  Workspace,
  createMemoryApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryMemoryNamespaceRepository } from "../src/memory-memory-namespace-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { LATER, NOW, otherWorkspaceId, workspaceId } from "./fixtures.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const scope = fakeControlPlaneScope(workspaceId);

describe("MemoryMemoryNamespaceRepository", () => {
  it("creates, reads, and lists namespaces", async () => {
    const { application } = await createHarness();
    const created = await application.createMemoryNamespace.execute(scope, {
      workspaceId,
      key: "notes",
      name: "Notes",
    });
    const loaded = await application.getMemoryNamespace.execute(
      scope,
      created.id,
    );
    const listed = await application.listMemoryNamespaces.execute(scope);

    expect(loaded).toEqual(created);
    expect(listed).toEqual([created]);
  });

  it("rejects an unknown namespace", async () => {
    const { application } = await createHarness();
    await expect(
      application.getMemoryNamespace.execute(
        scope,
        "missing" as MemoryNamespaceId,
      ),
    ).rejects.toBeInstanceOf(MemoryNamespaceNotFoundError);
  });

  it("rejects duplicate namespace keys within the same workspace", async () => {
    const { application } = await createHarness();
    await application.createMemoryNamespace.execute(scope, {
      workspaceId,
      key: "notes",
      name: "Notes",
    });

    await expect(
      application.createMemoryNamespace.execute(scope, {
        workspaceId,
        key: "notes",
        name: "Other Notes",
      }),
    ).rejects.toBeInstanceOf(DuplicateMemoryNamespaceKeyError);
  });

  it("allows the same namespace key in a different workspace", async () => {
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

    const repository = new MemoryMemoryNamespaceRepository();
    await repository.saveNamespace(
      MemoryNamespace.create({
        id: "memory-namespace-1" as MemoryNamespaceId,
        workspaceId,
        key: "shared-key",
        name: "Primary",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await repository.saveNamespace(
      MemoryNamespace.create({
        id: "memory-namespace-2" as MemoryNamespaceId,
        workspaceId: otherWorkspaceId,
        key: "shared-key",
        name: "Other Workspace Namespace",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    expect(
      await repository.listNamespacesByWorkspace(workspaceId),
    ).toHaveLength(1);
    expect(
      await repository.listNamespacesByWorkspace(otherWorkspaceId),
    ).toHaveLength(1);
  });

  it("sets, gets, lists, updates, and deletes records with revision semantics", async () => {
    const { repository } = await createHarness();
    const namespace = MemoryNamespace.create({
      id: "memory-namespace-records" as MemoryNamespaceId,
      workspaceId,
      key: "records",
      name: "Records",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.saveNamespace(namespace);

    const created = await repository.setRecord({
      namespaceId: namespace.id,
      key: "greeting",
      value: { text: "hello" },
      updatedAt: NOW,
    });
    expect(created.revision).toBe(MEMORY_RECORD_INITIAL_REVISION);

    const updated = await repository.setRecord({
      namespaceId: namespace.id,
      key: "greeting",
      value: { text: "hello again" },
      expectedRevision: created.revision,
      updatedAt: LATER,
    });
    expect(updated.revision).toBe(2);

    await repository.setRecord({
      namespaceId: namespace.id,
      key: "prefix/a",
      value: { n: 1 },
      updatedAt: LATER,
    });
    await repository.setRecord({
      namespaceId: namespace.id,
      key: "prefix/b",
      value: { n: 2 },
      updatedAt: LATER,
    });

    const page = await repository.listRecords({
      namespaceId: namespace.id,
      prefix: "prefix/",
      limit: 1,
    });
    expect(page.records.map((record) => record.key)).toEqual(["prefix/a"]);
    expect(page.nextCursor).toBe("prefix/a");

    await repository.deleteRecord({
      namespaceId: namespace.id,
      key: "greeting",
      expectedRevision: updated.revision,
    });
    expect(await repository.getRecord(namespace.id, "greeting")).toBeNull();
  });

  it("rejects stale revision updates and missing deletes", async () => {
    const { repository } = await createHarness();
    const namespace = MemoryNamespace.create({
      id: "memory-namespace-conflict" as MemoryNamespaceId,
      workspaceId,
      key: "conflict",
      name: "Conflict",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.saveNamespace(namespace);

    await repository.setRecord({
      namespaceId: namespace.id,
      key: "counter",
      value: { count: 1 },
      updatedAt: NOW,
    });

    await expect(
      repository.setRecord({
        namespaceId: namespace.id,
        key: "counter",
        value: { count: 2 },
        expectedRevision: 99,
        updatedAt: LATER,
      }),
    ).rejects.toBeInstanceOf(MemoryRecordConflictError);

    await expect(
      repository.deleteRecord({
        namespaceId: namespace.id,
        key: "missing",
      }),
    ).rejects.toBeInstanceOf(MemoryRecordNotFoundError);
  });

  it("isolates records by namespace", async () => {
    const { repository } = await createHarness();
    const first = MemoryNamespace.create({
      id: "memory-namespace-a" as MemoryNamespaceId,
      workspaceId,
      key: "a",
      name: "A",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const second = MemoryNamespace.create({
      id: "memory-namespace-b" as MemoryNamespaceId,
      workspaceId: otherWorkspaceId,
      key: "b",
      name: "B",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.saveNamespace(first);
    await repository.saveNamespace(second);

    await repository.setRecord({
      namespaceId: first.id,
      key: "secret",
      value: { token: "a" },
      updatedAt: NOW,
    });

    expect(await repository.getRecord(first.id, "secret")).not.toBeNull();
    expect(await repository.getRecord(second.id, "secret")).toBeNull();
  });
});

async function createHarness() {
  const workspaces = new MemoryWorkspaceRepository();
  const repository = new MemoryMemoryNamespaceRepository();
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
    application: createMemoryApplication({
      memoryNamespaces: repository,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `memory-namespace-${String(counter)}`;
        },
      },
    }),
  };
}
