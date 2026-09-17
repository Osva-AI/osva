import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";
import {
  DuplicateMemoryNamespaceKeyError,
  MEMORY_RECORD_INITIAL_REVISION,
  MemoryNamespace,
  MemoryRecordConflictError,
  MemoryRecordNotFoundError,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresMemoryNamespaceRepository } from "../../src/repositories/postgres-memory-namespace-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { EVEN_LATER, LATER, NOW, createIds } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL memory namespace repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let memory: PostgresMemoryNamespaceRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    memory = new PostgresMemoryNamespaceRepository(database);
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

  it("creates namespaces and isolates them by workspace", async () => {
    const first = createIds("memory-ws-a");
    const second = createIds("memory-ws-b");
    await seedWorkspace(first.workspaceId, "Workspace A");
    await seedWorkspace(second.workspaceId, "Workspace B");

    const namespaceA = MemoryNamespace.create({
      id: "memory-namespace-a" as MemoryNamespaceId,
      workspaceId: first.workspaceId,
      key: "shared-key",
      name: "Namespace A",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const namespaceB = MemoryNamespace.create({
      id: "memory-namespace-b" as MemoryNamespaceId,
      workspaceId: second.workspaceId,
      key: "shared-key",
      name: "Namespace B",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await memory.saveNamespace(namespaceA);
    await memory.saveNamespace(namespaceB);

    expect(
      await memory.findNamespaceByWorkspaceAndKey(
        first.workspaceId,
        "shared-key",
      ),
    ).toEqual(namespaceA);
    expect(
      await memory.findNamespaceByWorkspaceAndKey(
        second.workspaceId,
        "shared-key",
      ),
    ).toEqual(namespaceB);
    expect(await memory.listNamespacesByWorkspace(first.workspaceId)).toEqual([
      namespaceA,
    ]);
    expect(await memory.listNamespacesByWorkspace(second.workspaceId)).toEqual([
      namespaceB,
    ]);
  });

  it("rejects duplicate namespace keys within the same workspace", async () => {
    const ids = createIds("memory-duplicate");
    await seedWorkspace(ids.workspaceId);

    await memory.saveNamespace(
      MemoryNamespace.create({
        id: "memory-namespace-1" as MemoryNamespaceId,
        workspaceId: ids.workspaceId,
        key: "notes",
        name: "Notes",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await expect(
      memory.saveNamespace(
        MemoryNamespace.create({
          id: "memory-namespace-2" as MemoryNamespaceId,
          workspaceId: ids.workspaceId,
          key: "notes",
          name: "Other Notes",
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateMemoryNamespaceKeyError);
  });

  it("sets, gets, updates, lists, and deletes JSON records with revision semantics", async () => {
    const ids = createIds("memory-records");
    await seedWorkspace(ids.workspaceId);
    const namespace = await seedNamespace(
      ids.workspaceId,
      "records",
      "Records",
    );

    const created = await memory.setRecord({
      namespaceId: namespace.id,
      key: "greeting",
      value: { text: "hello" },
      updatedAt: NOW,
    });
    expect(created).toMatchObject({
      namespaceId: namespace.id,
      key: "greeting",
      value: { text: "hello" },
      revision: MEMORY_RECORD_INITIAL_REVISION,
    });

    const fetched = await memory.getRecord(namespace.id, "greeting");
    expect(fetched).toEqual(created);

    const updated = await memory.setRecord({
      namespaceId: namespace.id,
      key: "greeting",
      value: { text: "hello again" },
      expectedRevision: created.revision,
      updatedAt: LATER,
    });
    expect(updated.revision).toBe(created.revision + 1);
    expect(updated.value).toEqual({ text: "hello again" });

    await memory.setRecord({
      namespaceId: namespace.id,
      key: "prefix/a",
      value: { n: 1 },
      updatedAt: LATER,
    });
    await memory.setRecord({
      namespaceId: namespace.id,
      key: "prefix/b",
      value: { n: 2 },
      updatedAt: LATER,
    });
    await memory.setRecord({
      namespaceId: namespace.id,
      key: "other",
      value: { n: 3 },
      updatedAt: LATER,
    });

    const firstPage = await memory.listRecords({
      namespaceId: namespace.id,
      prefix: "prefix/",
      limit: 1,
    });
    expect(firstPage.records.map((record) => record.key)).toEqual(["prefix/a"]);
    expect(firstPage.nextCursor).toBe("prefix/a");

    const secondPage = await memory.listRecords({
      namespaceId: namespace.id,
      prefix: "prefix/",
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.records.map((record) => record.key)).toEqual([
      "prefix/b",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();

    await memory.deleteRecord({
      namespaceId: namespace.id,
      key: "greeting",
      expectedRevision: updated.revision,
    });
    expect(await memory.getRecord(namespace.id, "greeting")).toBeNull();
  });

  it("rejects stale revision updates and deletes with MEMORY conflict semantics", async () => {
    const ids = createIds("memory-conflict");
    await seedWorkspace(ids.workspaceId);
    const namespace = await seedNamespace(
      ids.workspaceId,
      "conflict",
      "Conflict",
    );

    const created = await memory.setRecord({
      namespaceId: namespace.id,
      key: "counter",
      value: { count: 1 },
      updatedAt: NOW,
    });

    await expect(
      memory.setRecord({
        namespaceId: namespace.id,
        key: "counter",
        value: { count: 2 },
        expectedRevision: 99,
        updatedAt: LATER,
      }),
    ).rejects.toBeInstanceOf(MemoryRecordConflictError);

    await expect(
      memory.deleteRecord({
        namespaceId: namespace.id,
        key: "counter",
        expectedRevision: 99,
      }),
    ).rejects.toBeInstanceOf(MemoryRecordConflictError);

    await expect(
      memory.setRecord({
        namespaceId: namespace.id,
        key: "missing",
        value: { count: 1 },
        expectedRevision: 1,
        updatedAt: EVEN_LATER,
      }),
    ).rejects.toBeInstanceOf(MemoryRecordConflictError);

    void created;
  });

  it("rejects deleting a missing record", async () => {
    const ids = createIds("memory-missing");
    await seedWorkspace(ids.workspaceId);
    const namespace = await seedNamespace(
      ids.workspaceId,
      "missing",
      "Missing",
    );

    await expect(
      memory.deleteRecord({
        namespaceId: namespace.id,
        key: "absent",
      }),
    ).rejects.toBeInstanceOf(MemoryRecordNotFoundError);
  });

  it("isolates records by namespace so workspace B cannot read workspace A data", async () => {
    const first = createIds("memory-records-a");
    const second = createIds("memory-records-b");
    await seedWorkspace(first.workspaceId, "Workspace A");
    await seedWorkspace(second.workspaceId, "Workspace B");

    const namespaceA = await seedNamespace(
      first.workspaceId,
      "store",
      "Store A",
    );
    const namespaceB = await seedNamespace(
      second.workspaceId,
      "store",
      "Store B",
    );

    await memory.setRecord({
      namespaceId: namespaceA.id,
      key: "secret",
      value: { token: "workspace-a" },
      updatedAt: NOW,
    });

    expect(await memory.getRecord(namespaceA.id, "secret")).toMatchObject({
      value: { token: "workspace-a" },
    });
    expect(await memory.getRecord(namespaceB.id, "secret")).toBeNull();
    expect(
      (
        await memory.listRecords({
          namespaceId: namespaceB.id,
          limit: 10,
        })
      ).records,
    ).toEqual([]);
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

  async function seedNamespace(
    workspaceId: WorkspaceId,
    key: string,
    name: string,
  ): Promise<MemoryNamespace> {
    const namespace = MemoryNamespace.create({
      id: `memory-namespace-${key}-${workspaceId}` as MemoryNamespaceId,
      workspaceId,
      key,
      name,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await memory.saveNamespace(namespace);
    return namespace;
  }
});
